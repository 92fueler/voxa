"""PostgreSQL connection boundary and forward-only, transactional schema migrations.

No provider calls or vector installation happen here. The schema keeps JSON text
verbatim so importing a SQLite archive does not rewrite its evidence.
"""

from typing import Any

import psycopg

SCHEMA_VERSION = 1
# One transaction lock preserves the original single-writer repository semantics,
# including category limits, claims and deletes, across independent connections.
STORE_LOCK = 0x564F5841

MIGRATIONS = (
    (
        1,
        (
            """CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )""",
            'CREATE UNIQUE INDEX categories_name_unique ON categories (lower(name COLLATE "C"))',
            """CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                started_at BIGINT NOT NULL,
                ended_at BIGINT,
                incomplete INTEGER NOT NULL DEFAULT 0 CHECK (incomplete IN (0,1)),
                deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
                revision BIGINT NOT NULL DEFAULT 0,
                issues TEXT NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues::jsonb) = 'array'),
                category_id TEXT REFERENCES categories(id) ON DELETE SET NULL
            )""",
            """CREATE TABLE turns (
                conversation_id TEXT NOT NULL REFERENCES conversations(id),
                provider_session_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                revision BIGINT NOT NULL,
                value TEXT NOT NULL CHECK (jsonb_typeof(value::jsonb) = 'object'),
                PRIMARY KEY (conversation_id,provider_session_id,item_id)
            )""",
            """CREATE TABLE summaries (
                conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
                source_revision BIGINT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending','running','ready','failed')),
                value TEXT CHECK (value IS NULL OR jsonb_typeof(value::jsonb) = 'object'),
                attempts INTEGER NOT NULL DEFAULT 0,
                available_at BIGINT NOT NULL DEFAULT 0,
                lease_until BIGINT NOT NULL DEFAULT 0,
                claim_token TEXT
            )""",
            "CREATE INDEX conversations_recent ON conversations (started_at DESC) WHERE deleted=0",
            "CREATE INDEX summaries_jobs ON summaries (status,available_at,lease_until)",
        ),
    ),
)


class Record(dict):
    """Match sqlite3.Row's keyed and positional reads without changing API shapes."""

    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def record_factory(cursor):
    names = [column.name for column in cursor.description or ()]
    return lambda values: Record(zip(names, values, strict=True))


def connect(database_url):
    """Connect with bounded waits; never print connection strings or driver errors."""
    connection = psycopg.connect(
        database_url,
        autocommit=True,
        row_factory=record_factory,
        connect_timeout=5,
        application_name="voxa",
    )
    try:
        connection.execute("SET statement_timeout = 10000")
        connection.execute("SET lock_timeout = 1000")
        connection.execute("SET idle_in_transaction_session_timeout = 30000")
        return connection
    except BaseException:
        connection.close()
        raise


def migrate(connection):
    """Apply all known migrations atomically, refusing unknown/future histories."""
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (STORE_LOCK,))
        connection.execute(
            """CREATE TABLE IF NOT EXISTS voxa_schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        applied = [
            row[0]
            for row in connection.execute("SELECT version FROM voxa_schema_migrations ORDER BY version")
        ]
        if applied != list(range(1, len(applied) + 1)) or any(v > SCHEMA_VERSION for v in applied):
            raise ValueError("Unsupported PostgreSQL schema version.")
        for version, statements in MIGRATIONS:
            if version not in applied:
                for statement in statements:
                    connection.execute(statement)
                connection.execute("INSERT INTO voxa_schema_migrations(version) VALUES (%s)", (version,))


def schema_status(connection):
    """Readiness metadata only: no transcript values, credentials or mutations."""
    exists = connection.execute("SELECT to_regclass('voxa_schema_migrations')").fetchone()[0]
    version = (
        connection.execute("SELECT COALESCE(MAX(version),0) FROM voxa_schema_migrations").fetchone()[0]
        if exists
        else 0
    )
    return {
        "schemaVersion": version,
        "supportedSchemaVersion": SCHEMA_VERSION,
        "vectorAvailable": bool(
            connection.execute("SELECT 1 FROM pg_available_extensions WHERE name='vector'").fetchone()
        ),
        "vectorEnabled": bool(
            connection.execute("SELECT 1 FROM pg_extension WHERE extname='vector'").fetchone()
        ),
    }


class PostgresDatabase:
    """Tiny parameter adapter for the shared repository's fixed SQL statements."""

    def __init__(self, database_url):
        self.connection: Any = connect(database_url)
        try:
            migrate(self.connection)
        except BaseException:
            self.connection.close()
            raise

    def execute(self, query, params=()):
        # Queries are internal constants only; user values always remain parameters.
        return self.connection.execute(query.replace("?", "%s"), params)

    def discard_after(self, error):
        if self.connection.closed or isinstance(error, (psycopg.OperationalError, psycopg.InterfaceError)):
            self.connection.close()
            return True
        return False

    def close(self):
        self.connection.close()
