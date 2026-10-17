# Python backend migration

Implemented October 17, 2026. The Python backend replaces the TypeScript server. React/Vite, the voice interaction and saved-conversation UI remain in place. This migration preserves existing behavior; it does not certify historically missing speech or solve the previously documented live-capture acceptance gaps.

## Run and ownership

From the repository root, run `make install`, then `make dev`. The browser stays on loopback 4317 and FastAPI/Uvicorn on loopback 4318. `make backend` starts just the API; `make frontend` starts only Vite. Configuration is read from the ignored `backend/.env` (moved from the old root location); the existing OpenAI key/model/session-limit settings remain compatible. Python changes require a backend restart, avoiding automatic interruption of a voice session.

Use one API process. Call handles, active source leases and preview reservations are in memory. A multi-worker deployment needs shared ownership/routing before it can be supported. SQLite and summary claims are durable, but a backend crash still loses provider events it never received; an in-memory queue cannot make them recoverable.

`make check` runs browser correctness/React-hook linting, TypeScript, full Pyrefly checking, Python lint/format, browser tests, Python tests, the client build and Python wheel/source builds. Tests use synthetic disposable data and never load the personal environment file or archive. Environment discovery uses a temporary fixture file. A built wheel contains the summary instructions/schema as package resources. Run an installed wheel from the backend working directory: it reads that directory’s `.env` and `data/`; editable source continues to resolve the backend project regardless of the caller’s working directory. No Node server or `node:sqlite` dependency remains.

The root contains documentation, `.gitignore` and `Makefile`. All npm files, browser sources and installed packages belong under `frontend/`; all Python metadata, sources, environment files, local virtual environment and archive data belong under `backend/`. Each project can be installed and checked independently. Backend Pyrefly configuration explicitly selects `.venv/bin/python` and the backend project/test import roots relative to its own project, with source-root guessing disabled; it does not mistake React files for Python sources.

## Boundaries

- `backend/src/app.py`: HTTP validation/security, composition and existing JSON/SDP contracts.
- `capture.py`: one-use setup handles, source protection, observer lifecycle, bounded finalization and save status.
- `save_queue.py`: coalesced serial writes, bounded memory and retries, independent of audio.
- `store.py`: schema-v4-compatible SQLite with one dedicated worker thread and at most 64 outstanding operations; synchronous locks stay off the event loop.
- `summaries.py`: evidence filtering/chunking, output validation and durable job runner.
- `context.py`: automatic recent-three selection, excerpt fallback and revision-bound context reservations.
- `providers/base.py`: separate VoiceProvider, SummaryProvider and TranscriptObserver ports plus opaque credential/call/observation types.
- `providers/openai.py` and `openai_transcript.py`: vendor HTTP/WebSocket schemas, credential validation, call ownership and wire normalization.
- `frontend/src/providers/realtime-protocol.ts`: browser wire adapter, keeping cancellation, commit, context insertion, cleanup events and direct signaling out of the audio resource lifecycle.
- `integrations/brainshuffle.py`: optional study-source adapter and versioned export.

OpenAI is the only installed provider adapter. Core services are exercised with an injected fixture provider named `fixture-vendor`, using different voice/summary model names and no OpenAI HTTP calls. `VOICE_PROVIDER` and `SUMMARY_PROVIDER` select registered adapters separately; unregistered names fail explicitly at startup. The browser currently implements `openai-realtime-v1`; a vendor using another audio protocol requires a matching browser adapter. The server rejects unsupported transports rather than claiming any vendor is interchangeable.

To add a provider: implement the appropriate port(s), map wire events to saved-turn observations inside that adapter, register its factory, add typed configuration/credential handling, then run contract/failure tests. For a new voice transport, add the browser protocol adapter and its media lifecycle tests. Preserve domain saved-turn IDs, predecessor links, revisions and interruption uncertainty. Never place provider keys in the client or accept caller-selected remote URLs/call IDs.

## Feature-parity contract

| Existing capability | Python behavior and evidence |
| --- | --- |
| Health and key gating | Same public health fields; missing-key 503; loading the UI issues no voice request. Host/Origin checks, body limits, strict input validation and no-store responses remain. Errors do not echo private provider/request bodies. |
| Spoken sessions | Same models, Marin voice, low-eagerness semantic VAD, audio-only output, 45-minute default and 30–2700-second range. Browser microphone, mute, interrupt, timeout and immediate End behavior retain their lifecycle tests. |
| Secure call setup | Saved/context sessions return opaque one-use handles, not secrets. SDP uses a server-owned credential; only a validated provider-returned call location becomes an observer ID. Saving-off/no-context still supports the temporary direct credential path. |
| Incremental capture | Backend-only observer normalization, revision deduplication and provider item ordering; no raw audio/event archives. Up to two reconnect attempts mark a gap instead of assuming replay. |
| Final turns after End | Browser stops mic/playback immediately, retains transport up to 15 seconds and best-effort commits active input. Python drains late observer events for 12 seconds, saves them before End/job scheduling and retains status for 60 seconds. Graceful Python shutdown also flushes already-received turns within a bound. |
| Storage | Same file, schema v4, JSON fields, millisecond timestamps, WAL, private file modes, 30-day retention and deletion tombstones. Versions 1–4 migrate without rewriting turn JSON; newer schemas are rejected. Storage queues/retries remain bounded. |
| History and deletion | Latest 100 sessions, compact excerpts/titles, transcript detail, category CRUD/assignment and unchanged transcript revisions when categorizing. Existing UI confirms destructive actions. Active captures/context sources remain protected; late writes/results cannot revive deleted content. |
| Titles and summaries | Same configured default model, strict grounded schema, local evidence validation, `store: false`, one serial claimed job, three attempts, 120-second leases, 30-second retry availability, 90-second job/30-second request bounds. Every input, including the merge, is bounded to 24,000 UTF-8 bytes after compact JSON serialization. Oversized merge inputs omit points round-robin with a coverage warning. Latest six bounded sections plus merge, automatic untitled backfill, revision-based reuse and stale-result rejection. |
| Automatic memory | Same latest-three eligible ended sources, ready-summary/finalized-excerpt fallback, 6,000 UTF-8 bytes, round-robin contribution, five-minute one-use previews, reservations and deletion protection. Saving-off still reads history without writing a new archive. |
| Compact saved UI | Existing typography, grouped rows, category popovers, delete confirmation, neutral summary display, title polling and per-turn interruption labels remain. No generic Transcript details/capture-warning block returns. |

The public API retains health/session/call, capture status/end, conversation list/detail/delete, categories create/list/rename/delete/assign, summary preparation and explicit context preview. Summary preparation accepts only the existing optional `requireTitle` query. Session responses additionally identify their browser `protocol` without removing existing fields. The browser accepts old responses without that descriptor for compatibility.

Legacy parity fixtures were captured from the immediately preceding TypeScript implementation, using synthetic data only. They compare 37 transcript sequences (including randomized ordering, bilingual text, interruption, missing finals, multipart output and context exclusion) and repository operations for revision, category, summary and tombstone behavior. Additional Python tests cover API validation, real SQLite locks/reopen/schema upgrades, expired/replaced claims, bounded queues/retries, provider errors, summary refusal and startup context. Matching fixtures demonstrate tested behavior, not every possible network condition.

## BrainShuffle preparation

The local source inspected was the separate `brain_shuffle` project, whose API defaults to port 8000 and serves `GET /api/problems/{problem_id}` under FastAPI. It has problem review submission but no conversation-summary import API. Its existing problem fields include `id`, `category_id`, `title`, `prompt`, `notes`, `tags` and `companies`.

Set `BRAINSHUFFLE_URL=http://127.0.0.1:8000` to enable the optional reader. Only explicit loopback HTTP origins are accepted. No connection occurs at startup or session creation. `GET /api/integrations/brainshuffle` reports configuration without making a remote call. `GET /api/integrations/brainshuffle/problems/{id}` reads the specified problem with a three-second overall deadline, 256,000-byte cap, UUID identity check and redirects disabled. It returns the study title/prompt/tags/companies and category ID; hidden solution/reference notes are omitted. This prepares the backend read boundary; it does not yet insert study material into voice sessions or add study controls.

`GET /api/conversations/{id}/export` returns `schemaVersion: 1`, `source: "voxa"`, `exportedAt` and a conversation object with source ID/revision/timestamps/category, current ready summary (or null), ordered turns and uncertainty metadata. It makes no BrainShuffle write and does not infer a review rating. A future BrainShuffle importer should deduplicate by `(source, conversation.id, conversation.revision)`, map its own problem IDs separately from Voxa category IDs, and preserve uncertainty/evidence links. Define deletion propagation and import confirmation before adding automatic copies; Voxa’s local deletion cannot remove an independently exported copy.

Both apps retain separate storage and dependency environments. No BrainShuffle files, settings, processes or personal data were modified for this preparation. Contract tests use synthetic HTTP responses matching its inspected schema. Live connectivity, a study-session picker and summary write-back remain future work.

## Archive safety and rollback

Before migration the old app was stopped, SQLite’s backup API created `backend/data/migration-backup/before-python.sqlite`, and the original server sources were preserved in `typescript-server.tar.gz` beside a content checksum snapshot. The entire directory is ignored and contains private data; never stage it. The archive moved intact from the old root `data/` into `backend/data/conversations.sqlite`; it is not imported into a new format. Backend defaults resolve relative to the backend project, so launching from the repository root or either project directory does not create a second archive.

Do not overwrite the active database with the backup after new conversations have been saved: that would lose newer work. For troubleshooting, stop both services, preserve the current archive with SQLite backup, then inspect a disposable copy. Schema v4 is unchanged, so the original server reference can read the current compatible file if a rollback is needed. Restore source/runtime tooling together from a reviewed checkpoint/reference; do not run two backends against active setup handles. Keep credentials and archived transcripts local.

## Acceptance boundary

Offline fixtures and builds do not establish audible voice, real microphone cleanup, final ASR delivery or spoken memory. The remaining human check is a short bilingual session with an interruption, End immediately after final words, inspection of the saved final turns/title, then a new session asking about a distinctive prior fact. Existing gaps in these behaviors are carried forward explicitly; this migration does not reconstruct old audio or label uncertain historical captures complete.
