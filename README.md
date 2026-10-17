# voxa

Personal voice learning companion with audio input and spoken responses.

The local voice MVP includes automatic background transcript saving and a saved-conversation viewer. Voice sessions require an OpenAI API key. New sessions automatically remember the three most recent eligible ended conversations, within a compact context budget. Learning modes and automatic reconnection/rollover remain planned. Detailed live acceptance checks remain tracked in `docs/PLANS.md`.

## Run locally

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 22.13+ and npm. The local Python selection is 3.13; SQLite uses Python’s standard library. The backend is FastAPI; React/Vite remains TypeScript.

```sh
make install
make dev
```

Open [Voxa](http://127.0.0.1:4317/). The API runs on `127.0.0.1:4318`. Both bind only to loopback; port conflicts stop startup. Port 5173 is not used.

The page and health endpoint work without credentials. Start is disabled until the backend has a key. No provider request occurs just by loading the page.

## Enable a real voice conversation

1. Copy `backend/.env.example` to `backend/.env` if the file does not already exist. The initial local setup may already have created an empty `backend/.env`.
2. Set `OPENAI_API_KEY` in `backend/.env` using your own editor. Do not paste the key into chat or put it in a `VITE_` variable.
3. Restart `make dev`, then use **Check again** in the app.
4. Start a conversation and allow microphone access. Speak a question, listen to the reply, then try a follow-up.
5. End the session and confirm the browser microphone indicator turns off.

API usage is separately billed and requires account/model access. Sessions default to 45 minutes, including provider connection time; `SESSION_MAX_SECONDS` permits 30–2700 seconds. Restart the backend after changing `backend/.env`, and refresh the page before starting a new conversation. Existing sessions retain their original limit. This browser timeout is a safety control, not an exact spending guarantee. Muting does not end the session. Audible expiry warnings and automatic continuation are not implemented yet.

The permanent key stays on the backend. Audio flows directly over WebRTC with OpenAI. For saved sessions, the backend handles the SDP handshake using a short-lived credential and attaches an event observer to its own call; the browser receives a one-use setup handle. No-save sessions continue using a temporary browser credential. The provider's own data controls still apply.

## Saved conversations

Transcripts are saved automatically; there is no saving checkbox. Storage, memory and API-usage details are available under **Privacy & memory** in the footer, keeping the voice controls uncluttered. Saved sessions enable separate input transcription, which has additional API usage charges. Completed user/assistant transcript events are written incrementally to `backend/data/conversations.sqlite` by a dedicated SQLite worker thread; storage retries and status polling do not gate spoken responses. No raw audio is recorded.

Open **Saved conversations** and use **Refresh** to browse the latest saved turns. The list shows concise conversation titles, dates and saved-turn counts grouped by category. Titles are generated automatically together with the background summary after final transcript saving. Existing untitled ended conversations are prepared automatically too (additional API usage); there is no title button. Until a title is ready, a short opening excerpt provides an immediate label. Titles match the conversation’s main language and can still contain model mistakes. Use **+ Category** to add a category, the **···** menu beside its heading to rename or remove it, and a conversation’s compact category selector to move it. Removing a category keeps its conversations in **Uncategorized**.

Open a conversation to see a concise **Summary** above its turns. It reuses the existing background summary without another model call, prioritizing topics, decisions and next questions in up to three brief points. Preparing or unavailable summaries use short neutral messages; generic capture diagnostics are not displayed. Capture metadata remains internal, and interrupted/missing text stays identifiable in the individual turns.

An empty completed transcription is not a missing final event. Harmless idle-cancellation and tagged End empty-buffer errors do not count as transcript loss. Interrupted output is labeled; generated assistant text is not proof that every word was heard. Saving can be delayed or incomplete if the database, event observer, or network fails. Queues/retries are bounded, and a process crash can lose uncommitted turns.

Transcripts expire automatically after 30 days. Click **Delete** beside a conversation to review a confirmation, then **Delete permanently** to remove its text and summary, or **Cancel** to keep it. A capture diagnostic never prevents deletion. The backend blocks deletion only while voice/setup is actively using that conversation or its capture is finalizing; unrelated old conversations remain deletable during voice. The UI always saves new transcripts. The internal API still supports saving-off sessions for tests/future controls: no new durable transcript or summary is created, while existing history still loads. The database and credentials are ignored by Git. Existing sessions cannot be retroactively captured.

### Automatic conversation continuity

Every new session automatically includes the three most recent eligible ended conversations. There is no history checkbox, selection form or preview step. The backend uses ready summaries and recent finalized excerpts under a 6,000-byte UTF-8 cap. Pending or failed summaries use bounded finalized excerpts immediately, so starting voice does not wait for a new summary call. Active, empty, deleted, expired and unusable conversations are excluded. This is recent context, not exhaustive recall of the full archive.

New saved sessions prepare a compact background summary after the final transcript drain. Existing untitled ended conversations are queued automatically in bounded batches, with exhausted retries left exhausted. One structured response includes both a short title and evidence-linked summary points; no separate title model or request is added. Summaries use `gpt-5.6-terra` with reasoning disabled through the Responses API with `store: false`; this adds API usage and follows the provider's retention controls. Jobs run separately from voice, recover after restart, and retry at most three times automatically. Summary wording can still be inaccurate.

A long transcript is split into bounded sections and merged. Each job processes at most the latest six sections (24,000 UTF-8 bytes of input each), plus one merge request; limited coverage is labeled. It has a 90-second overall deadline and 30-second per-request deadline. Unfinished, interrupted and unordered turns are excluded; missing speech is never reconstructed. Summaries are reused while their source revision is unchanged.

The context cap is a content-size limit, not an exact token count or a limit on the subsequent live conversation. History loads once at startup, before the microphone is unmuted, after acknowledgment from the provider. If history cannot be read or loaded, setup stops and releases media instead of silently losing continuity. The injected archive is not copied into the new transcript. Deleting a source used by active voice/setup is blocked until that session ends. With saving off, a transient server handle protects those sources, but no transcript observer or durable new conversation is created.

Summaries are stored in the same ignored SQLite database and expire or are deleted with their source session. The app does not infer permanent learning notes, retrieve unselected sessions, or automatically roll over the 45-minute voice session.

New conversations use patient turn detection (`semantic_vad`, `eagerness: low`) to allow more time during thinking pauses. It still estimates whether you have finished; it does not guarantee a minimum silence interval. Start a new conversation to pick up changes to these settings. A manual “done speaking” mode is planned in V05.

## Providers and BrainShuffle

Voice and summary providers are separate Python interfaces. `VOICE_PROVIDER` and `SUMMARY_PROVIDER` default to `openai`; `SUMMARY_MODEL` defaults to the existing `gpt-5.6-terra`. Existing `backend/.env` files work unchanged. The OpenAI adapter owns credentials, model request schemas, SDP exchange, sideband connections and event normalization. Core archive, history, category and summary-job services do not call OpenAI directly. Only OpenAI is implemented today; another provider needs a tested adapter. The browser transport is also isolated behind a protocol adapter; a provider with a different voice protocol needs its corresponding browser adapter, rather than just a new URL.

BrainShuffle support is prepared against its existing local problem API. Set `BRAINSHUFFLE_URL=http://127.0.0.1:8000` only when you want to use the read connector. `GET /api/integrations/brainshuffle` reports configuration without contacting it. `GET /api/integrations/brainshuffle/problems/{id}` reads a specific problem’s title, prompt, tags and companies, omitting hidden solution notes. `GET /api/conversations/{id}/export` provides a versioned conversation handoff with the current summary, turns and uncertainty metadata. These are API capabilities; there is no new study-picker UI, automatic history injection from BrainShuffle, write-back or shared database. A destination importer and explicit review flow are required before sending summaries/grades back.

See [the migration and parity contract](docs/PYTHON_BACKEND.md) for extension points, limits, verification and rollback. The pre-migration archive and original backend reference are backed up under ignored `backend/data/migration-backup/`; they contain private runtime data and must stay local.

## Verify

```sh
make check
```

This runs browser correctness/React-hook linting, TypeScript checks, Python lint/format checks, browser lifecycle tests, Python API/provider tests, SQLite persistence/reopen/lock tests, the Vite build, and Python wheel/source builds. Legacy transcript/repository oracle fixtures also check the Python port against the previous TypeScript behavior. Tests use disposable synthetic data and make no paid API calls. A passing result does not establish audible speech, bilingual quality, latency, real sideband/transcription delivery, or real browser microphone cleanup; those need live/manual checks.

For an automatic-history check, save a short conversation containing a distinctive fact, start another session, and ask about it. Confirm microphone tracks stay muted until history is acknowledged. The internal saving-off path is covered by fixtures: previous history loads without a new archive entry. Check an empty archive and unavailable storage. Automated fixtures and previous synthetic provider checks do not establish spoken recall or audible timing.

For a bounded saving check, start a new saved session, speak a short bilingual exchange, interrupt one reply, then End. The microphone and playback stop immediately. Saving shows **Finishing final transcript** while the observer accepts late events for up to 12 seconds; the client closes the remaining transport by 15 seconds. Received turns keep saving independently. Refresh Saved conversations and check ordering, final words, interruption markers, and save status. Missing finalization remains incomplete rather than being reported as a complete save. The internal API saving-off exclusion is checked with disposable fixtures; the UI always saves. Do not use a full 45-minute run as the first verification.

Run the backend alone with `make backend`, or the web client with `make frontend`. For focused checks, use `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck`, `npm --prefix frontend test`, `uv run --directory backend --locked pyrefly check`, and `uv run --directory backend --locked pytest -q`. `make build` produces `frontend/dist/` plus Python packages in `backend/dist/`. Restart the backend after Python or environment changes; it does not reload active voice automatically. Use one API process; multiple Uvicorn workers are unsupported while setup handles and context reservations are in memory. The documented launch workflow is the local dev server, not a production deployment.

Pyrefly is configured in `backend/pyproject.toml` to use `backend/.venv/bin/python`, the Python source under `backend/src/`, and `backend/tests/`. Pydantic is a direct Python dependency. `make check` includes the full Pyrefly check. If an editor retains old missing-import diagnostics after the folder move, restart its Python language server or reload the window; select `backend/.venv/bin/python` if it asks for an interpreter. Configuration follows [Pyrefly’s documented interpreter and search-path settings](https://pyrefly.org/en/docs/configuration/).

If your personal npm configuration returns an authentication error for these public packages, try `npm --prefix frontend --userconfig=/dev/null --registry=https://registry.npmjs.org ci`. This does not modify your global npm settings.

## Repository layout

```text
voxa/
├── frontend/              # React/Vite application and npm tooling
│   ├── src/               # UI, voice lifecycle, provider adapter and shared types
│   ├── package.json
│   └── vite.config.ts
├── backend/               # Python project and uv tooling
│   ├── src/          # API, services, storage, providers and integrations
│   ├── tests/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── .env               # Local credentials, ignored
│   └── data/              # Local archive and migration backups, ignored
├── docs/                  # Design, plans, migration contract and scenarios
├── Makefile               # Run/install/check/build both projects
├── README.md
└── AGENTS.md
```

See [design](docs/DESIGN.md), [development plan and evidence](docs/PLANS.md), [Python migration](docs/PYTHON_BACKEND.md), and [repository instructions](AGENTS.md).

The design and plan distinguish proposals, offline verification, and live results. Follow the plan's dependencies and keep implementation changes focused.
