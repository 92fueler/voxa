"""Explicit schema management and lossless SQLite-to-PostgreSQL import commands."""

import argparse
import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .postgres import SCHEMA_VERSION, STORE_LOCK, connect, migrate, schema_status

# Identifiers are constants, never supplied by a user or database row.
TABLE_COLUMNS = {
    "categories": ("id", "name"),
    "conversations": (
        "id",
        "started_at",
        "ended_at",
        "incomplete",
        "deleted",
        "revision",
        "issues",
        "category_id",
    ),
    "turns": ("conversation_id", "provider_session_id", "item_id", "revision", "value"),
    "summaries": (
        "conversation_id",
        "source_revision",
        "status",
        "value",
        "attempts",
        "available_at",
        "lease_until",
        "claim_token",
    ),
}
DEFAULTS = {"issues": "[]", "category_id": None}


class ImportRejected(ValueError):
    """Public, content-free rejection that is safe to display on the command line."""


@contextmanager
def open_source(path):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ImportRejected("The SQLite source must be an existing regular file.")
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=1)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA trusted_schema=OFF")
    try:
        yield connection
    finally:
        connection.close()


def snapshot_sqlite(source_path, backup_path):
    """Read-only online backup includes committed WAL data; never overwrite a file.

    Stop the old API before cutover. A snapshot is consistent but deliberately does
    not copy later writes, change the source journal mode, or delete the source.
    """
    backup_path = Path(backup_path)
    # Reject aliases before opening the destination, and require an existing parent.
    if Path(source_path).resolve(strict=True) == backup_path.resolve():
        raise ImportRejected("The backup must be separate from the SQLite source.")
    with open_source(source_path) as source:
        fd = os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        try:
            target = sqlite3.connect(backup_path)
            try:
                deadline = time.monotonic() + 30

                def progress(status, remaining, total):
                    if time.monotonic() > deadline:
                        raise TimeoutError("SQLite snapshot timed out.")

                source.backup(target, pages=256, sleep=0.05, progress=progress)
            finally:
                target.close()
        except BaseException:
            # Retain a failed/partial backup for inspection; never replace or remove it.
            raise ImportRejected("SQLite backup failed; inspect the new backup before retrying.") from None
    return backup_path


def read_archive(connection):
    """Validate schema 1–4 and normalize only absent legacy columns in memory."""
    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise ImportRejected("SQLite integrity verification failed.")
    if connection.execute("PRAGMA foreign_key_check").fetchone():
        raise ImportRejected("SQLite contains broken foreign-key references.")
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version not in (1, 2, 3, 4):
        raise ImportRejected("Only SQLite archive schema versions 1–4 are supported.")
    tables = {
        r[0]
        for r in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    required = (
        {"conversations", "turns"}
        | ({"summaries"} if version >= 3 else set())
        | ({"categories"} if version >= 4 else set())
    )
    if not required <= tables or not tables <= TABLE_COLUMNS.keys():
        raise ImportRejected("SQLite archive tables do not match a supported schema.")
    archive = {}
    for table, columns in TABLE_COLUMNS.items():
        if table not in tables:
            archive[table] = []
            continue
        present = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        missing = set(columns) - present
        allowed_missing = ({"issues"} if version < 2 else set()) | ({"category_id"} if version < 4 else set())
        if missing - allowed_missing or present - set(columns):
            raise ImportRejected("SQLite archive columns do not match a supported schema.")
        archive[table] = [
            {key: row[key] if key in present else DEFAULTS[key] for key in columns}
            for row in connection.execute(f"SELECT * FROM {table}")
        ]
    try:
        for conversation in archive["conversations"]:
            if not isinstance(json.loads(conversation["issues"]), list):
                raise ValueError
        for table in ("turns", "summaries"):
            for row in archive[table]:
                if row["value"] is not None and not isinstance(json.loads(row["value"]), dict):
                    raise ValueError
    except (TypeError, ValueError):
        raise ImportRejected("SQLite archive contains invalid JSON evidence.") from None
    return version, archive


def archive_digest(archive):
    """Stable content digest also checks exact JSON strings, IDs and job metadata."""
    normalized = {
        table: sorted(
            ([row[column] for column in columns] for row in archive[table]),
            key=lambda row: json.dumps(row, ensure_ascii=False, separators=(",", ":")),
        )
        for table, columns in TABLE_COLUMNS.items()
    }
    return hashlib.sha256(
        json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def import_archive(connection, archive):
    """Import into an empty migrated target; verify within the same transaction.

    A failure rolls back all imported rows. The schema itself is managed separately.
    Advisory and table locks prevent another app connection from racing emptiness.
    """
    expected_digest = archive_digest(archive)
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (STORE_LOCK,))
        connection.execute("LOCK TABLE categories,conversations,turns,summaries IN ACCESS EXCLUSIVE MODE")
        for table in TABLE_COLUMNS:
            if connection.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise ImportRejected("The PostgreSQL archive is not empty; no rows were imported.")
        for table, columns in TABLE_COLUMNS.items():
            placeholders = ",".join(["%s"] * len(columns))
            query = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})"
            with connection.cursor() as cursor:
                cursor.executemany(query, [tuple(row[c] for c in columns) for row in archive[table]])
        actual = {
            table: [dict(row) for row in connection.execute(f"SELECT {','.join(columns)} FROM {table}")]
            for table, columns in TABLE_COLUMNS.items()
        }
        if archive_digest(actual) != expected_digest:
            raise ImportRejected("Imported content verification failed; all imported rows were rolled back.")
    return {
        "counts": {table: len(rows) for table, rows in archive.items()},
        "contentSha256": expected_digest,
        "verified": True,
    }


def import_sqlite(database_url, source_path, backup_path):
    backup = snapshot_sqlite(source_path, backup_path)
    with open_source(backup) as source:
        version, archive = read_archive(source)
    with connect(database_url) as connection:
        migrate(connection)
        result = import_archive(connection, archive)
    return {"sqliteSchemaVersion": version, "postgresSchemaVersion": SCHEMA_VERSION, **result}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Voxa PostgreSQL schema and explicit SQLite import")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="Read schema and pgvector readiness, without migration")
    commands.add_parser("migrate", help="Apply forward-only PostgreSQL schema migrations")
    importer = commands.add_parser(
        "import-sqlite", help="Snapshot, import and verify a stopped legacy archive"
    )
    importer.add_argument("--source", type=Path, required=True)
    importer.add_argument(
        "--backup", type=Path, required=True, help="New private backup path; must not exist"
    )
    importer.add_argument(
        "--execute", action="store_true", help="Confirm the explicit import into an empty target"
    )
    args = parser.parse_args(argv)
    url = os.getenv("DATABASE_URL", "")
    if not url.startswith(("postgresql://", "postgres://")):
        parser.error("Set DATABASE_URL to the target PostgreSQL URL; it is never printed.")
    if args.command == "import-sqlite" and not args.execute:
        parser.error("Stop the legacy API, review source/backup/target, then pass --execute to import.")
    try:
        if args.command == "import-sqlite":
            result = import_sqlite(url, args.source, args.backup)
        else:
            with connect(url) as connection:
                if args.command == "migrate":
                    migrate(connection)
                result = schema_status(connection)
        print(json.dumps(result, sort_keys=True))
    except ImportRejected as error:
        parser.exit(1, f"Import rejected: {error}\n")
    except Exception:
        parser.exit(
            1,
            "Database command failed. Check connectivity, permissions and schema; connection details are suppressed.\n",
        )


if __name__ == "__main__":
    main()
