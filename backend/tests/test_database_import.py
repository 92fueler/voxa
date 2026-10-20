import hashlib
import sqlite3

import pytest
from conftest import seed
from postgres_fixture import postgres_url as postgres_url
from psycopg import sql

from src.database import (
    ImportRejected,
    archive_digest,
    import_archive,
    import_sqlite,
    main,
    open_source,
    read_archive,
    snapshot_sqlite,
)
from src.postgres import connect, migrate
from src.store import ConversationStore


async def test_readonly_backup_preserves_source_wal_and_json(store, tmp_path):
    item_id = await seed(store, ready=True)
    before = hashlib.sha256(store.path.read_bytes()).hexdigest()
    backup = snapshot_sqlite(store.path, tmp_path / "backup.sqlite")
    assert hashlib.sha256(store.path.read_bytes()).hexdigest() == before
    assert backup.stat().st_mode & 0o777 == 0o600
    with open_source(backup) as connection:
        version, archive = read_archive(connection)
        with pytest.raises(sqlite3.OperationalError):
            connection.execute("DELETE FROM conversations")
    assert version == 4
    assert archive["conversations"][0]["id"] == item_id
    assert archive["turns"][0]["value"].find("Synthetic 你好") >= 0
    assert archive["summaries"][0]["status"] == "ready"
    with pytest.raises(FileExistsError):
        snapshot_sqlite(store.path, backup)
    with pytest.raises(ImportRejected, match="separate"):
        snapshot_sqlite(store.path, store.path)


@pytest.mark.parametrize("version", [1, 2, 3, 4, 99])
def test_legacy_import_preflight_never_upgrades_source(tmp_path, version):
    source = tmp_path / "legacy.sqlite"
    with sqlite3.connect(source) as connection:
        connection.executescript(
            "CREATE TABLE conversations(id TEXT PRIMARY KEY,started_at INTEGER NOT NULL,ended_at INTEGER,incomplete INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0);"
            "CREATE TABLE turns(conversation_id TEXT NOT NULL REFERENCES conversations(id),provider_session_id TEXT NOT NULL,item_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(conversation_id,provider_session_id,item_id));"
        )
        if version >= 2:
            connection.execute("ALTER TABLE conversations ADD COLUMN issues TEXT NOT NULL DEFAULT '[]'")
        if version >= 3:
            connection.execute(
                "CREATE TABLE summaries(conversation_id TEXT PRIMARY KEY,source_revision INTEGER,status TEXT,value TEXT,attempts INTEGER,available_at INTEGER,lease_until INTEGER,claim_token TEXT)"
            )
        if version >= 4:
            connection.execute("CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT)")
            connection.execute("ALTER TABLE conversations ADD COLUMN category_id TEXT")
        connection.execute("INSERT INTO conversations(id,started_at) VALUES ('old',1)")
        connection.execute(f"PRAGMA user_version={version}")
    before = source.read_bytes()
    with open_source(source) as connection:
        if version > 4:
            with pytest.raises(ImportRejected, match="versions 1–4"):
                read_archive(connection)
        else:
            actual, archive = read_archive(connection)
            assert actual == version
            assert archive["conversations"][0]["issues"] == "[]"
            assert archive["conversations"][0]["category_id"] is None
    assert source.read_bytes() == before


async def test_postgres_import_exact_verification_and_nonempty_refusal(store, tmp_path, postgres_url):
    item_id = await seed(store, ready=True)
    await store.run("category-create", {"id": "topic", "name": "Fixture"})
    await store.run("categorize", {"id": item_id, "categoryId": "topic"})
    tombstone = await seed(store)
    await store.run("delete", {"id": tombstone})
    before = await store.run("get", {"id": item_id})
    await store.close()
    source_hash = hashlib.sha256(store.path.read_bytes()).hexdigest()
    result = import_sqlite(postgres_url, store.path, tmp_path / "first.sqlite")
    assert result["verified"] is True
    assert result["counts"] == {"categories": 1, "conversations": 2, "turns": 1, "summaries": 1}
    assert hashlib.sha256(store.path.read_bytes()).hexdigest() == source_hash
    postgres = ConversationStore(database_url=postgres_url)
    try:
        assert await postgres.run("get", {"id": item_id}) == before
        assert await postgres.run("get", {"id": tombstone}) is None
        with pytest.raises(ImportRejected, match="not empty"):
            import_sqlite(postgres_url, store.path, tmp_path / "second.sqlite")
        assert await postgres.run("get", {"id": item_id}) == before
    finally:
        await postgres.close()
    assert hashlib.sha256(store.path.read_bytes()).hexdigest() == source_hash


async def test_postgres_import_failure_rolls_back_all_rows(store, tmp_path, postgres_url):
    await seed(store)
    with open_source(snapshot_sqlite(store.path, tmp_path / "snapshot.sqlite")) as connection:
        _, archive = read_archive(connection)
    archive["turns"][0]["conversation_id"] = "missing-parent"
    with connect(postgres_url) as connection:
        migrate(connection)
        with pytest.raises(Exception):
            import_archive(connection, archive)
        for table in archive:
            assert connection.execute(
                sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
            ).fetchone() == {"count": 0}


def test_digest_checks_json_formatting_and_cli_hides_credentials(monkeypatch, capsys):
    archive = {"categories": [], "conversations": [], "turns": [], "summaries": []}
    assert len(archive_digest(archive)) == 64
    monkeypatch.setenv("DATABASE_URL", "postgresql://private:secret@localhost:1/fixture")
    with pytest.raises(SystemExit):
        main(["status"])
    error = capsys.readouterr().err
    assert "secret" not in error and "private" not in error
    assert "connection details are suppressed" in error


def test_import_cli_requires_explicit_execute(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused/fixture")
    with pytest.raises(SystemExit):
        main(["import-sqlite", "--source", str(tmp_path / "source"), "--backup", str(tmp_path / "backup")])
    assert "pass --execute" in capsys.readouterr().err
    assert not (tmp_path / "backup").exists()
