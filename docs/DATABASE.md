# PostgreSQL storage and legacy import

PostgreSQL is the deployment storage backend. Local Compose provides PostgreSQL 17 with pgvector available. `DATABASE_URL` selects it; an unset URL keeps the existing local SQLite path for offline fixtures and legacy local development. A configured but unavailable PostgreSQL database never silently falls back to SQLite. The web and iOS clients use the same backend archive API, not direct database credentials.

## Runtime and schema

- `ConversationStore(path, database_url=...)` keeps the existing async operation contract. A PostgreSQL URI passed as `path` also works. SQLite schema versions 1–4 continue to open as before; no automatic cross-database import occurs.
- Blocking Psycopg or SQLite calls run on a dedicated one-thread worker, with at most 64 pending operations. Caller cancellation does not cancel a queued write. PostgreSQL connections have bounded connect, statement, lock and idle-transaction waits.
- Every operation is transactional. A PostgreSQL transaction-scoped advisory lock preserves existing single-writer semantics for revisions, summary leases, category limits and deletion. This is deliberately conservative, not a high-throughput distributed queue. Still run one API process: session handles and context reservations remain process-local.
- PostgreSQL schema version 1 creates conversations, turns, summaries, categories and indexes. `voxa_schema_migrations` records forward-only transactional migrations. Unknown/future/noncontiguous migration history fails closed. Schema updates run on first use or explicitly with `voxa-db migrate`; the production startup health check opens the store before serving.
- JSON evidence is stored as validated text and queried through PostgreSQL JSON operators. IDs, millisecond timestamps, raw JSON strings, revisions, incomplete reasons, tombstones, category assignments and summary job state survive import unchanged. PostgreSQL uses `BIGINT` for timestamps/revisions. ASCII case-insensitive category uniqueness matches legacy SQLite `NOCASE` behavior.
- Transcript/summary retention remains 30 days, applied opportunistically on the same archive/summary operations as before. Deletion removes turns and summaries but retains a tombstone to reject late writes. Database backups can retain historical copies: their retention and deletion are separate operational responsibilities. This scaffolding does not provide a scheduled erasure worker or encryption/key management.
- A broken connection fails the affected operation rather than replaying an ambiguously committed transaction; the next operation reconnects. Application storage errors are generic and do not include connection strings or transcript contents.

Run management commands with `DATABASE_URL` supplied securely through the environment (for example the local ignored environment file loaded by Compose). Do not paste production credentials into shell history or command arguments:

```sh
uv run --directory backend --locked voxa-db status
uv run --directory backend --locked voxa-db migrate
```

`status` reads schema and pgvector readiness without applying migrations. `migrate` applies schema changes and reports status. Neither command prints the database URL. No downgrade or destructive reset command is provided. Back up before future schema upgrades and test restoring to a new database rather than downgrading in place.

## pgvector readiness, not automatic memory

The Compose bootstrap installs the `vector` extension using its database administrator. The application role does not need superuser access, and the app neither installs extensions nor generates embeddings. `voxa-db status` reports both server availability and whether the extension is enabled. On a managed service, an authorized database administrator can enable it separately:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

There are no vector columns, embedding jobs, vector indexes, automatic retrieval or additional model calls in this increment. An embedding model, dimensions, evidence/consent boundaries, expiry and deletion semantics must be chosen in a later reviewed schema migration. Existing selected-summary-only memory behavior remains intact.

## Safe one-time SQLite import

The importer is an explicit offline cutover tool, not a sync mechanism. Do not run it against personal data without reviewing the source and destination. The target must be a dedicated, empty Voxa PostgreSQL archive. Even a tombstone or category counts as nonempty. Import will not merge, overwrite, clear the target or delete the source.

1. Stop the legacy API and finish active conversations. Keep it stopped through verification and cutover. The snapshot captures a consistent point in time, not writes made afterward.
2. Review `DATABASE_URL` locally and check `voxa-db status`. Ensure the PostgreSQL role has permission to create the schema objects, and that the intended target is empty. For remote databases use certificate-verified TLS according to the deployment's trust setup.
3. Choose a new backup filename in a private existing directory. Do not copy just the main SQLite file while WAL is active. The command uses SQLite's read-only online backup API, which includes committed WAL data, does not migrate or rewrite the source and refuses existing backup paths. A backup is created with mode `0600`. A failed partial backup is retained for inspection instead of overwritten or deleted.
4. Run the explicit import:

```sh
uv run --directory backend --locked voxa-db import-sqlite \
  --source /absolute/path/to/conversations.sqlite \
  --backup /private/existing/directory/voxa-before-postgres.sqlite \
  --execute
```

5. Inspect the content-free success output: SQLite/PostgreSQL schema versions, per-table counts, `verified: true`, and a SHA-256 content digest. The importer verifies SQLite integrity and foreign keys, accepts only known archive tables/columns from versions 1–4, preserves existing JSON strings, and fills only absent legacy issues/category columns in memory. Source and backup are not schema-upgraded. Keep the backup private and out of Git.
6. Imported rows and verification run in one PostgreSQL transaction with advisory and exclusive table locks. Empty-target checks run under the same locks. All inserted rows roll back on any insert, foreign-key or digest mismatch. Schema creation is a separate transaction and may remain even when the data import is refused. The verification digest includes all columns and exact stored JSON strings, not just counts.
7. Start a single API against PostgreSQL. Review representative conversations, categories, summary state and deletion/expiry using synthetic fixtures first. No provider/model requests are necessary for database verification. Starting the normal summary runner with real credentials may process pending imported summary jobs and incur API charges.
8. Keep the stopped SQLite source and backup until the cutover is accepted. For rollback before new PostgreSQL writes, stop the API and restore its original SQLite configuration. Once new writes exist in PostgreSQL, switching back loses those new sessions from view: stop and plan reconciliation rather than silently reverting. Bidirectional sync/export is not implemented.

A snapshot operation is bounded to 30 seconds; if writes or locks prevent completion, the source remains untouched and the partial backup remains. Stop the writer and choose a new backup path after inspection. Do not point the importer at BrainShuffle or another application's database.

## Verification

Offline SQLite compatibility and source safety tests run without a database:

```sh
uv run --directory backend --locked pytest -q tests/test_store.py tests/test_database_import.py
```

Real PostgreSQL tests are opt-in. Set `VOXA_TEST_DATABASE_URL` to a disposable PostgreSQL database whose test role can create schemas, then run:

```sh
uv run --directory backend --locked pytest -q tests/test_postgres.py tests/test_database_import.py
```

Each test creates and removes only its own UUID-named schema. It never truncates public tables. Without the variable, PostgreSQL-dependent tests are explicitly skipped; passing offline tests does not establish PostgreSQL integration. Coverage includes reopen/dedup/tombstones, retention and categories, concurrent claims/revision invalidation, a real lock timeout with responsive event loop, schema idempotency/future rejection, exact import parity, nonempty-target refusal and full rollback on foreign-key failure. No provider calls, personal archives, cloud deployment or AWS resource changes are involved.

Reference APIs: [Psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html), [SQLite online backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup), [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), and [pgvector](https://github.com/pgvector/pgvector).
