import asyncio
import sqlite3

import pytest
from conftest import seed, turn

from src.store import ConversationStore
from src.util import now_ms


async def test_reopen_dedup_isolation_and_delete_tombstones(store):
    item_id = await seed(store)
    source = await store.run("get", {"id": item_id})
    await store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn()})
    assert (await store.run("get", {"id": item_id}))["revision"] == source["revision"]
    await store.close()
    reopened = ConversationStore(store.path)
    try:
        assert (await reopened.run("get", {"id": item_id}))["turns"] == source["turns"]
        await reopened.run("delete", {"id": item_id})
        await reopened.run("create", {"id": item_id, "startedAt": now_ms()})
        await reopened.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn(revision=10)})
        assert await reopened.run("get", {"id": item_id}) is None
    finally:
        await reopened.close()


async def test_real_lock_does_not_block_event_loop_and_recovers(store):
    item_id = await seed(store)
    lock = sqlite3.connect(store.path, isolation_level=None)
    lock.execute("BEGIN IMMEDIATE")
    try:
        write = asyncio.create_task(
            store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn(revision=2)})
        )
        await asyncio.sleep(0.01)
        assert not write.done()
        with pytest.raises(RuntimeError, match="^Conversation storage is unavailable.$"):
            await write
    finally:
        lock.execute("ROLLBACK")
        lock.close()
    await store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn(revision=2)})
    assert (await store.run("get", {"id": item_id}))["revision"] == 2


@pytest.mark.parametrize("version", [1, 2, 3, 4])
async def test_existing_schema_versions_preserve_json_and_metadata(tmp_path, version):
    path = tmp_path / "legacy.sqlite"
    db = sqlite3.connect(path)
    db.executescript(
        "CREATE TABLE conversations(id TEXT PRIMARY KEY,started_at INTEGER NOT NULL,ended_at INTEGER,incomplete INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0); CREATE TABLE turns(conversation_id TEXT NOT NULL REFERENCES conversations(id),provider_session_id TEXT NOT NULL,item_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(conversation_id,provider_session_id,item_id));"
    )
    if version >= 2:
        db.execute("ALTER TABLE conversations ADD COLUMN issues TEXT NOT NULL DEFAULT '[]'")
    if version >= 3:
        db.execute(
            "CREATE TABLE summaries(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),source_revision INTEGER NOT NULL,status TEXT NOT NULL,value TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,claim_token TEXT)"
        )
        db.execute(
            "INSERT INTO summaries(conversation_id,source_revision,status) VALUES ('legacy',1,'pending')"
        )
    if version >= 4:
        db.execute("CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE)")
        db.execute(
            "ALTER TABLE conversations ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL"
        )
    db.execute(
        "INSERT INTO conversations(id,started_at,ended_at,incomplete,revision) VALUES ('legacy',?,?,1,1)",
        (now_ms(), now_ms()),
    )
    raw = '{ "itemId":"u", "previousItemId":null, "orderKnown":true, "speaker":"user", "text":"合成🌿", "status":"completed", "revision":1, "createdAt":1 }'
    db.execute("INSERT INTO turns VALUES ('legacy','p','u',1,?)", (raw,))
    db.execute(f"PRAGMA user_version={version}")
    db.commit()
    db.close()
    migrated = ConversationStore(path)
    try:
        source = await migrated.run("get", {"id": "legacy"})
        assert source["incomplete"] == 1 and source["revision"] == 1 and source["issues"] == []
        assert source["turns"][0]["text"] == "合成🌿"
        assert (source["summary"] or {}).get("status") == ("pending" if version >= 3 else None)
    finally:
        await migrated.close()
    db = sqlite3.connect(path)
    assert db.execute("SELECT value FROM turns").fetchone()[0] == raw
    assert db.execute("PRAGMA user_version").fetchone()[0] == 4
    db.close()


async def test_future_schema_rejected_without_modification(tmp_path):
    path = tmp_path / "future.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA user_version=99")
    before = path.read_bytes()
    store = ConversationStore(path)
    try:
        with pytest.raises(RuntimeError):
            await store.run("list")
    finally:
        await store.close()
    assert path.read_bytes() == before


async def test_expiry_removes_summary_and_turns_but_keeps_tombstone(store):
    item_id = await seed(store, ready=True)
    with sqlite3.connect(store.path) as db:
        db.execute("UPDATE conversations SET started_at=? WHERE id=?", (now_ms() - 31 * 86400000, item_id))
    assert await store.run("list") == []
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT COUNT(*) FROM turns").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM summaries").fetchone()[0] == 0
        assert db.execute("SELECT deleted FROM conversations").fetchone()[0] == 1


async def test_claim_recovery_stale_results_and_bounded_attempts(store):
    item_id = await seed(store)
    now = now_ms()
    first = await store.run("summary-claim", {"claimToken": "a", "now": now})
    assert await store.run("summary-claim", {"claimToken": "early", "now": now + 1}) is None
    assert await store.run("summary-claim", {"claimToken": "b", "now": now + 121000})
    assert not await store.run(
        "summary-result", {"id": item_id, "revision": first["revision"], "claimToken": "a", "summary": {}}
    )
    assert await store.run("summary-claim", {"claimToken": "c", "now": now + 242000})
    assert await store.run("summary-claim", {"claimToken": "d", "now": now + 363000}) is None
    assert (await store.run("get", {"id": item_id}))["summary"]["status"] == "failed"
    assert await store.run("summary-backfill") == 0
    await store.run("summary-request", {"id": item_id})
    assert await store.run("summary-claim", {"claimToken": "retry", "now": now})


async def test_revision_warning_and_delete_invalidate_summary_claim(store):
    item_id = await seed(store, ready=True)
    before = await store.run("get", {"id": item_id})
    await store.run("incomplete", {"id": item_id, "reason": "transcript_pending"})
    await store.run("incomplete", {"id": item_id, "reason": "transcript_pending"})
    await store.run("incomplete", {"id": item_id, "reason": "PRIVATE"})
    after = await store.run("get", {"id": item_id})
    assert after["revision"] == before["revision"] + 1
    assert after["title"] is None and after["issues"] == ["transcript_pending"]
    claim = await store.run("summary-claim", {"claimToken": "claim", "now": now_ms()})
    await store.run("delete", {"id": item_id})
    assert not await store.run(
        "summary-result", {"id": item_id, "revision": claim["revision"], "claimToken": "claim", "summary": {}}
    )


async def test_storage_errors_are_sanitized_and_categories_bounded(tmp_path, store):
    bad = ConversationStore("/dev/null/PRIVATE/archive.sqlite")
    try:
        with pytest.raises(RuntimeError, match="^Conversation storage is unavailable.$"):
            await bad.run("list")
    finally:
        await bad.close()
    for n in range(50):
        await store.run("category-create", {"id": str(n), "name": f"Category {n}"})
    with pytest.raises(RuntimeError):
        await store.run("category-create", {"id": "over", "name": "Too many"})


async def test_backfill_legacy_title_without_resetting_failed_jobs(store):
    item_id = await seed(store)
    job = await store.run("summary-claim", {"claimToken": "legacy", "now": now_ms()})
    await store.run(
        "summary-result",
        {
            "id": item_id,
            "revision": job["revision"],
            "claimToken": "legacy",
            "summary": {
                "points": [],
                "warnings": [],
                "sourceRevision": job["revision"],
                "model": "legacy",
                "createdAt": 1,
            },
        },
    )
    assert await store.run("summary-backfill") == 1
    assert (await store.run("get", {"id": item_id}))["summary"]["status"] == "pending"
    assert await store.run("summary-backfill") == 0


async def test_repository_submission_bound_and_cancellation_do_not_drop_writes(store, monkeypatch):
    import threading

    gate, entered = threading.Event(), threading.Event()
    original = store._run

    def blocked(op, payload):
        entered.set()
        gate.wait(2)
        return original(op, payload)

    monkeypatch.setattr(store, "_run", blocked)
    first = asyncio.create_task(store.run("create", {"id": "canceled", "startedAt": now_ms()}))
    while not entered.is_set():
        await asyncio.sleep(0.001)
    rest = [asyncio.create_task(store.run("categories")) for _ in range(63)]
    await asyncio.sleep(0.005)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert store.pending == 64
    with pytest.raises(RuntimeError):
        await store.run("categories")
    gate.set()
    await asyncio.gather(*rest)
    assert await store.run("get", {"id": "canceled"}) is not None
