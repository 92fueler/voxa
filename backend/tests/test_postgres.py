import asyncio

import psycopg
import pytest
from conftest import seed, turn
from postgres_fixture import postgres_url as postgres_url

from src.postgres import SCHEMA_VERSION, STORE_LOCK, PostgresDatabase, connect, migrate, schema_status
from src.store import ConversationStore
from src.util import now_ms


@pytest.fixture
async def pg_store(postgres_url):
    store = ConversationStore(database_url=postgres_url)
    yield store
    await store.close()


async def test_postgres_archive_parity_and_tombstones(pg_store, postgres_url):
    assert await pg_store.run("health") == {"ok": True}
    item_id = await seed(pg_store, ready=True)
    before = await pg_store.run("get", {"id": item_id})
    assert before["title"] == "Synthetic title"
    assert before["previewText"] == "Synthetic 你好"
    assert before["turnCount"] == 1
    assert before["summaryStatus"] == "ready"
    assert before["summary"]["sourceRevision"] == before["revision"]
    await pg_store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn()})
    assert (await pg_store.run("get", {"id": item_id}))["revision"] == before["revision"]
    await pg_store.close()
    reopened = ConversationStore(postgres_url)
    try:
        assert await reopened.run("get", {"id": item_id}) == before
        await reopened.run("delete", {"id": item_id})
        await reopened.run("create", {"id": item_id, "startedAt": now_ms()})
        await reopened.run("turn", {"id": item_id, "turn": turn(revision=2)})
        assert await reopened.run("get", {"id": item_id}) is None
    finally:
        await reopened.close()


async def test_postgres_categories_claims_and_retention(pg_store, postgres_url):
    await pg_store.run("category-create", {"id": "bq", "name": "BQ"})
    with pytest.raises(RuntimeError):
        await pg_store.run("category-create", {"id": "duplicate", "name": "bq"})
    item_id = await seed(pg_store)
    assert await pg_store.run("categorize", {"id": item_id, "categoryId": "bq"})
    assert (await pg_store.run("list"))[0]["categoryId"] == "bq"
    assert await pg_store.run("category-delete", {"id": "bq"})
    assert (await pg_store.run("get", {"id": item_id}))["categoryId"] is None
    first = await pg_store.run("summary-claim", {"claimToken": "first", "now": now_ms()})
    assert first is not None
    with connect(postgres_url) as connection:
        connection.execute("UPDATE conversations SET started_at=%s", (now_ms() - 31 * 86400000,))
    assert await pg_store.run("list") == []
    assert not await pg_store.run(
        "summary-result", {"id": item_id, "revision": first["revision"], "claimToken": "first", "summary": {}}
    )
    with connect(postgres_url) as connection:
        assert connection.execute("SELECT COUNT(*) FROM turns").fetchone() == {"count": 0}
        assert connection.execute("SELECT COUNT(*) FROM summaries").fetchone() == {"count": 0}
        assert connection.execute("SELECT deleted FROM conversations").fetchone() == {"deleted": 1}


async def test_postgres_concurrent_claims_and_revision_invalidation(pg_store, postgres_url):
    item_id = await seed(pg_store)
    other = ConversationStore(database_url=postgres_url)
    try:
        now = now_ms()
        claims = await asyncio.gather(
            pg_store.run("summary-claim", {"claimToken": "one", "now": now}),
            other.run("summary-claim", {"claimToken": "two", "now": now}),
        )
        assert sum(claim is not None for claim in claims) == 1
        claim = next(c for c in claims if c is not None)
        await other.run("incomplete", {"id": item_id, "reason": "transcript_pending"})
        await other.run("incomplete", {"id": item_id, "reason": "transcript_pending"})
        changed = await pg_store.run("get", {"id": item_id})
        assert changed["revision"] == claim["revision"] + 1
        assert changed["issues"] == ["transcript_pending"]
        for token in ("one", "two"):
            assert not await pg_store.run(
                "summary-result",
                {"id": item_id, "revision": claim["revision"], "claimToken": token, "summary": {}},
            )
        assert await other.run("summary-backfill") == 0
    finally:
        await other.close()


async def test_postgres_lock_timeout_keeps_loop_responsive_and_recovers(pg_store, postgres_url):
    await pg_store.run("health")
    with connect(postgres_url) as connection:
        with connection.transaction():
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (STORE_LOCK,))
            task = asyncio.create_task(pg_store.run("create", {"id": "locked", "startedAt": now_ms()}))
            await asyncio.sleep(0.02)
            assert not task.done()
            with pytest.raises(RuntimeError, match="^Conversation storage is unavailable.$"):
                await task
    await pg_store.run("create", {"id": "recovered", "startedAt": now_ms()})
    assert (await pg_store.run("get", {"id": "recovered"}))["id"] == "recovered"


def test_postgres_migrations_idempotent_and_future_rejected(postgres_url):
    with connect(postgres_url) as connection:
        migrate(connection)
        migrate(connection)
        assert schema_status(connection)["schemaVersion"] == SCHEMA_VERSION
        assert connection.execute("SELECT COUNT(*) FROM voxa_schema_migrations").fetchone() == {"count": 1}
        connection.execute("INSERT INTO voxa_schema_migrations(version) VALUES (999)")
        with pytest.raises(ValueError, match="Unsupported PostgreSQL schema"):
            migrate(connection)
        assert connection.execute("SELECT MAX(version) FROM voxa_schema_migrations").fetchone() == {
            "max": 999
        }


def test_postgres_url_validation_and_no_fallback(tmp_path):
    with pytest.raises(ValueError, match="DATABASE_URL must use PostgreSQL"):
        ConversationStore(tmp_path / "unused.sqlite", database_url="sqlite:///no")


async def test_disconnected_worker_discards_connection_without_replaying(monkeypatch):
    class BrokenConnection:
        closed = True
        attempts = 0

        def execute(self, *args):
            self.attempts += 1
            raise psycopg.OperationalError("PRIVATE CONNECTION DETAILS")

        def close(self):
            pass

    broken = object.__new__(PostgresDatabase)
    broken.connection = BrokenConnection()
    store = ConversationStore(database_url="postgresql://unused/fixture")
    store.db = broken
    try:
        with pytest.raises(RuntimeError, match="^Conversation storage is unavailable.$"):
            await store.run("health")
        assert store.db is None
        assert broken.connection.attempts == 2  # BEGIN and attempted ROLLBACK, no replay.

        class ReconnectedDatabase:
            def execute(self, *args):
                return None

            def close(self):
                pass

        monkeypatch.setattr("src.store.PostgresDatabase", lambda url: ReconnectedDatabase())
        assert await store.run("health") == {"ok": True}
    finally:
        await store.close()


async def test_postgres_server_disconnect_recovers_next_operation(pg_store, postgres_url):
    await pg_store.run("health")
    backend_pid = pg_store.db.connection.info.backend_pid
    with connect(postgres_url) as connection:
        connection.execute("SELECT pg_terminate_backend(%s)", (backend_pid,))
    with pytest.raises(RuntimeError, match="^Conversation storage is unavailable.$"):
        await pg_store.run("health")
    assert await pg_store.run("health") == {"ok": True}
