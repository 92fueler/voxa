"""Shared archive repository with PostgreSQL and legacy SQLite worker backends."""

import asyncio
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import ROOT
from .postgres import STORE_LOCK, PostgresDatabase
from .util import encode, now_ms

FIELDS = """id,started_at AS startedAt,ended_at AS endedAt,incomplete,revision,issues,category_id AS categoryId,
(SELECT COUNT(*) FROM turns WHERE conversation_id=conversations.id) AS turnCount,
(SELECT json_extract(value,'$.title') FROM summaries WHERE conversation_id=conversations.id AND source_revision=conversations.revision AND status='ready') AS title,
(SELECT status FROM summaries WHERE conversation_id=conversations.id AND source_revision=conversations.revision) AS summaryStatus,
(SELECT substr(trim(json_extract(value,'$.text')),1,80) FROM turns WHERE conversation_id=conversations.id
AND json_extract(value,'$.speaker')='user' AND json_extract(value,'$.status')='completed' AND json_extract(value,'$.orderKnown')=1
AND trim(json_extract(value,'$.text'))<>'' ORDER BY json_extract(value,'$.previousItemId') IS NULL DESC,json_extract(value,'$.createdAt'),item_id LIMIT 1) AS previewText"""
POSTGRES_FIELDS = """id,started_at AS "startedAt",ended_at AS "endedAt",incomplete,revision,issues,category_id AS "categoryId",
(SELECT COUNT(*) FROM turns WHERE conversation_id=conversations.id) AS "turnCount",
(SELECT value::jsonb->>'title' FROM summaries WHERE conversation_id=conversations.id AND source_revision=conversations.revision AND status='ready') AS title,
(SELECT status FROM summaries WHERE conversation_id=conversations.id AND source_revision=conversations.revision) AS "summaryStatus",
(SELECT substr(trim(value::jsonb->>'text'),1,80) FROM turns WHERE conversation_id=conversations.id
AND value::jsonb->>'speaker'='user' AND value::jsonb->>'status'='completed' AND value::jsonb->>'orderKnown' IN ('true','1')
AND trim(value::jsonb->>'text')<>'' ORDER BY (value::jsonb->>'previousItemId') IS NULL DESC,(value::jsonb->>'createdAt')::bigint,item_id LIMIT 1) AS "previewText"
"""
ISSUES = {
    "observer_unavailable",
    "observer_disconnected",
    "observer_event_error",
    "provider_error",
    "transcript_error",
    "transcript_pending",
    "ordering_gap",
}


class ConversationStore:
    def __init__(self, path=None, *, database_url=None):
        target = database_url or (str(path) if path is not None else "")
        self.postgres = target.startswith(("postgresql://", "postgres://"))
        if database_url and not self.postgres:
            raise ValueError("DATABASE_URL must use PostgreSQL.")
        self.database_url = target if self.postgres else None
        self.path = (
            None if self.postgres else Path(path) if path is not None else ROOT / "data/conversations.sqlite"
        )
        self.fields = POSTGRES_FIELDS if self.postgres else FIELDS
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="voxa-store")
        self.db = None
        self.closed = False
        self.pending = 0

    async def run(self, operation, payload=None):
        if self.closed or self.pending >= 64:
            raise RuntimeError("Conversation storage is unavailable.")
        try:
            self.pending += 1
            future = asyncio.get_running_loop().run_in_executor(
                self.executor, self._run, operation, payload or {}
            )

            def completed(result):
                self.pending -= 1
                # A timed-out caller must not cancel a queued storage operation or hide its exception.
                if not result.cancelled():
                    result.exception()

            future.add_done_callback(completed)
            return await asyncio.shield(future)
        except Exception:
            raise RuntimeError("Conversation storage is unavailable.") from None

    def _database(self):
        if self.db:
            return self.db
        if self.postgres:
            self.db = PostgresDatabase(self.database_url)
            return self.db
        assert self.path is not None
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=0.1, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            self.path.chmod(0o600)
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 4:
                raise ValueError("Unsupported schema")
            db.executescript(
                "PRAGMA busy_timeout=100; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;"
            )
            # Upgrade atomically. Existing JSON and timestamps are never rewritten.
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,started_at INTEGER NOT NULL,ended_at INTEGER,incomplete INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS turns(conversation_id TEXT NOT NULL REFERENCES conversations(id),provider_session_id TEXT NOT NULL,item_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(conversation_id,provider_session_id,item_id))"
            )
            if version < 2:
                db.execute("ALTER TABLE conversations ADD COLUMN issues TEXT NOT NULL DEFAULT '[]'")
            db.execute(
                "CREATE TABLE IF NOT EXISTS summaries(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),source_revision INTEGER NOT NULL,status TEXT NOT NULL,value TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,claim_token TEXT)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE)"
            )
            if version < 4:
                db.execute(
                    "ALTER TABLE conversations ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL"
                )
            db.execute("PRAGMA user_version=4")
            db.execute("COMMIT")
            self.db = db
            return db
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            db.close()
            raise

    def _detail(self, db, item_id):
        row = db.execute(
            f"SELECT {self.fields} FROM conversations WHERE id=? AND deleted=0", (item_id,)
        ).fetchone()
        if not row:
            return None
        row = dict(row)
        row["issues"] = json.loads(row["issues"])
        row["turns"] = [
            json.loads(t[0])
            for t in db.execute("SELECT value FROM turns WHERE conversation_id=?", (item_id,))
        ]
        summary = db.execute(
            'SELECT source_revision AS "sourceRevision",status,value FROM summaries WHERE conversation_id=?',
            (item_id,),
        ).fetchone()
        row["summary"] = (
            {**dict(summary), "value": json.loads(summary["value"]) if summary["value"] else None}
            if summary
            else None
        )
        return row

    def _remove(self, db, item_id):
        db.execute("DELETE FROM summaries WHERE conversation_id=?", (item_id,))
        db.execute("DELETE FROM turns WHERE conversation_id=?", (item_id,))
        db.execute("UPDATE conversations SET deleted=1,incomplete=1 WHERE id=?", (item_id,))

    def _expire(self, db):
        for row in db.execute(
            "SELECT id FROM conversations WHERE started_at<? AND deleted=0", (now_ms() - 30 * 86400000,)
        ).fetchall():
            self._remove(db, row[0])

    def _title(self, field):
        return f"({field}::jsonb->>'title')" if self.postgres else f"json_extract({field},'$.title')"

    def _schedule(self, db, item_id, force=False, require_title=False):
        row = db.execute(
            "SELECT revision,ended_at FROM conversations WHERE id=? AND deleted=0", (item_id,)
        ).fetchone()
        if (
            not row
            or not row["ended_at"]
            or not db.execute("SELECT 1 FROM turns WHERE conversation_id=? LIMIT 1", (item_id,)).fetchone()
        ):
            return
        db.execute(
            f"""INSERT INTO summaries(conversation_id,source_revision,status) VALUES (?,?,'pending')
        ON CONFLICT(conversation_id) DO UPDATE SET source_revision=excluded.source_revision,status='pending',value=NULL,attempts=0,available_at=0,lease_until=0,claim_token=NULL
        WHERE summaries.source_revision<>excluded.source_revision OR (? AND summaries.status='failed') OR (? AND summaries.status='ready' AND ({self._title("summaries.value")} IS NULL OR trim({self._title("summaries.value")})=''))""",
            (item_id, row["revision"], force, require_title),
        )

    def _run(self, operation, p):
        db = self._database()
        try:
            db.execute(
                "BEGIN" if self.postgres or operation in ("list", "get", "categories") else "BEGIN IMMEDIATE"
            )
            if self.postgres:
                db.execute("SELECT pg_advisory_xact_lock(?)", (STORE_LOCK,))
            value = self._operate(db, operation, p)
            db.execute("COMMIT")
            return value
        except BaseException as error:
            try:
                db.execute("ROLLBACK")
            except Exception:
                if self.postgres:
                    db.close()
                    self.db = None
            if isinstance(db, PostgresDatabase) and db.discard_after(error):
                self.db = None
            # Never replay an uncertain write. A subsequent operation may reconnect.
            raise

    def _operate(self, d, op, p):
        item_id = p.get("id")
        if op == "health":
            return {"ok": True}
        elif op == "create":
            d.execute(
                "INSERT INTO conversations(id,started_at) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
                (item_id, p["startedAt"]),
            )
        elif op == "turn":
            turn = p["turn"]
            result = d.execute(
                """INSERT INTO turns SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND deleted=0)
            ON CONFLICT(conversation_id,provider_session_id,item_id) DO UPDATE SET revision=excluded.revision,value=excluded.value WHERE excluded.revision>turns.revision""",
                (
                    item_id,
                    p.get("providerSessionId") or "",
                    turn["itemId"],
                    turn["revision"],
                    encode(turn),
                    item_id,
                ),
            )
            if result.rowcount:
                d.execute("UPDATE conversations SET revision=revision+1 WHERE id=? AND deleted=0", (item_id,))
                self._schedule(d, item_id)
        elif op == "finish":
            d.execute(
                f"UPDATE conversations SET ended_at=COALESCE(ended_at,?),incomplete={'GREATEST' if self.postgres else 'MAX'}(incomplete,?) WHERE id=? AND deleted=0",
                (p["endedAt"], int(bool(p.get("incomplete"))), item_id),
            )
            self._schedule(d, item_id)
        elif op == "incomplete":
            row = d.execute(
                "SELECT issues,incomplete FROM conversations WHERE id=? AND deleted=0", (item_id,)
            ).fetchone()
            if row:
                reasons = json.loads(row["issues"])
                if p.get("reason") in ISSUES and p["reason"] not in reasons:
                    reasons.append(p["reason"])
                encoded = encode(reasons)
                if not row["incomplete"] or reasons != json.loads(row["issues"]):
                    d.execute(
                        "UPDATE conversations SET incomplete=1,issues=?,revision=revision+1 WHERE id=? AND deleted=0",
                        (encoded, item_id),
                    )
                    self._schedule(d, item_id)
        elif op in ("list", "get"):
            self._expire(d)
            if op == "get":
                return self._detail(d, item_id)
            return [
                {**dict(r), "issues": json.loads(r["issues"])}
                for r in d.execute(
                    f"SELECT {self.fields} FROM conversations WHERE deleted=0 ORDER BY started_at DESC LIMIT 100"
                )
            ]
        elif op == "delete":
            self._remove(d, item_id)
        elif op == "summary-backfill":
            self._expire(d)
            rows = d.execute(f"""SELECT c.id FROM conversations c LEFT JOIN summaries s ON s.conversation_id=c.id WHERE c.deleted=0 AND c.ended_at IS NOT NULL AND EXISTS(SELECT 1 FROM turns WHERE conversation_id=c.id)
            AND (s.conversation_id IS NULL OR s.source_revision<>c.revision OR (s.status='ready' AND ({self._title("s.value")} IS NULL OR trim({self._title("s.value")})='')))
            ORDER BY c.started_at DESC LIMIT 100""").fetchall()
            for row in rows:
                self._schedule(d, row[0], require_title=True)
            return len(rows)
        elif op == "summary-request":
            self._expire(d)
            self._schedule(d, item_id, True, p.get("requireTitle") is True)
            source = self._detail(d, item_id)
            return source["summary"] if source else None
        elif op == "summary-claim":
            self._expire(d)
            row = d.execute(
                """SELECT s.conversation_id FROM summaries s JOIN conversations c ON c.id=s.conversation_id WHERE c.deleted=0 AND c.ended_at IS NOT NULL AND s.source_revision=c.revision AND s.attempts<3
            AND ((s.status='pending' AND s.available_at<=?) OR (s.status='running' AND s.lease_until<=?)) ORDER BY c.ended_at LIMIT 1""",
                (p["now"], p["now"]),
            ).fetchone()
            value = None
            if row:
                d.execute(
                    "UPDATE summaries SET status='running',attempts=attempts+1,claim_token=?,lease_until=? WHERE conversation_id=?",
                    (p["claimToken"], p["now"] + 120000, row[0]),
                )
                value = self._detail(d, row[0])
            d.execute(
                "UPDATE summaries SET status='failed',claim_token=NULL WHERE status='running' AND lease_until<=? AND attempts>=3",
                (p["now"],),
            )
            return value
        elif op == "summary-result":
            self._expire(d)
            return bool(
                d.execute(
                    """UPDATE summaries SET status='ready',value=?,claim_token=NULL,lease_until=0 WHERE conversation_id=? AND source_revision=? AND claim_token=? AND status='running'
            AND EXISTS(SELECT 1 FROM conversations WHERE id=? AND deleted=0 AND revision=?)""",
                    (encode(p["summary"]), item_id, p["revision"], p["claimToken"], item_id, p["revision"]),
                ).rowcount
            )
        elif op == "summary-failed":
            d.execute(
                "UPDATE summaries SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,available_at=?,lease_until=0,claim_token=NULL WHERE conversation_id=? AND claim_token=? AND status='running'",
                (p["now"] + 30000, item_id, p["claimToken"]),
            )
        elif op == "categories":
            order = 'lower(name COLLATE "C")' if self.postgres else "name COLLATE NOCASE"
            return [dict(r) for r in d.execute(f"SELECT id,name FROM categories ORDER BY {order}")]
        elif op == "category-create":
            if d.execute("SELECT COUNT(*) FROM categories").fetchone()[0] >= 50:
                raise ValueError("Category limit")
            d.execute("INSERT INTO categories(id,name) VALUES (?,?)", (item_id, p["name"]))
            return {"id": item_id, "name": p["name"]}
        elif op == "category-rename":
            return bool(d.execute("UPDATE categories SET name=? WHERE id=?", (p["name"], item_id)).rowcount)
        elif op == "category-delete":
            return bool(d.execute("DELETE FROM categories WHERE id=?", (item_id,)).rowcount)
        elif op == "categorize":
            self._expire(d)
            if (
                p["categoryId"] is not None
                and not d.execute("SELECT 1 FROM categories WHERE id=?", (p["categoryId"],)).fetchone()
            ):
                raise ValueError("Unknown category")
            return bool(
                d.execute(
                    "UPDATE conversations SET category_id=? WHERE id=? AND deleted=0",
                    (p["categoryId"], item_id),
                ).rowcount
            )
        else:
            raise ValueError("Unknown operation")
        return None

    async def close(self):
        if self.closed:
            return
        self.closed = True

        def close_db():
            if self.db:
                self.db.close()

        await asyncio.get_running_loop().run_in_executor(self.executor, close_db)
        self.executor.shutdown(wait=False)
