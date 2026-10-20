# voxa

Personal voice learning companion with audio input and spoken responses.

The local voice MVP includes automatic background transcript saving and a saved-conversation viewer. Voice sessions require an OpenAI API key. New sessions start without saved memory unless you select conversation summaries in Saved conversations. Learning modes and automatic reconnection/rollover remain planned. Detailed live acceptance checks remain tracked in `docs/PLANS.md`.

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
4. Match **Microphone noise filter** to the microphone selected in your browser: **Laptop microphone** or **Earbuds / headset**. This adjusts filtering; it does not switch physical devices.
5. Start a conversation and allow microphone access. Speak a question, listen to the reply, then try a follow-up.
6. End the session and confirm the browser microphone indicator turns off.

API usage is separately billed and requires account/model access. Sessions default to 45 minutes, including provider connection time; `SESSION_MAX_SECONDS` permits 30–2700 seconds. Restart the backend after changing `backend/.env`, and refresh the page before starting a new conversation. Existing sessions retain their original limit. This browser timeout is a safety control, not an exact spending guarantee. Muting does not end the session. Audible expiry warnings and automatic continuation are not implemented yet.

The permanent key stays on the backend. Audio flows directly over WebRTC with OpenAI. For saved sessions, the backend handles the SDP handshake using a short-lived credential and attaches an event observer to its own call; the browser receives a one-use setup handle. No-save sessions continue using a temporary browser credential. The provider's own data controls still apply.

## Live transcript

During voice, **Your live transcript** shows your six most recent speech turns directly from browser events, without waiting for archive polling. Partial text is labeled **Draft · may change**. The provider’s finalized text replaces the draft exactly; **Finalized** means transcription finished, not that saving succeeded. Missing/failed finals and drafts remaining at End are marked **Unconfirmed**. Empty final transcriptions remain distinguishable from missing text. This compact view shows your speech; assistant turns remain in Saved conversations. Voxa does not translate caption text in the client: it displays the provider’s returned transcription, which may contain recognition/language errors. Spoken response language is separate from caption rendering.

This display uses the existing transcription model and turn detection, with no extra audio connection or model request. It cannot show text before the provider emits it or guarantee captions while you are still speaking. Draft updates are batched over 80 ms; final text displays immediately on receipt. Only finalized user speech controls automatic pacing. Drafts are held in memory, excluded from persistence/history, and cleared when a new session starts or the page closes. The archive retains its separate server capture/final-drain and refresh workflow; late final text after End may appear there while the live draft remains unconfirmed.

## Saved conversations

Transcripts are saved automatically; there is no saving checkbox. Storage, memory and API-usage details are available under **Privacy & memory** in the footer, keeping the voice controls uncluttered. Saved sessions enable separate input transcription, which has additional API usage charges. Completed user/assistant transcript events are written incrementally to `backend/data/conversations.sqlite` by a dedicated SQLite worker thread; storage retries and status polling do not gate spoken responses. No raw audio is recorded.

Open **Saved conversations** and use **Refresh** to browse the latest saved turns. The list shows concise conversation titles, dates and saved-turn counts grouped by category. Titles are generated automatically together with the background summary after final transcript saving. Existing untitled ended conversations are prepared automatically too (additional API usage); there is no title button. Until a title is ready, a short opening excerpt provides an immediate label. Titles match the conversation’s main language and can still contain model mistakes. Use **+ Category** to add a category, the **···** menu beside its heading to rename or remove it, and the category selector in a conversation’s detail view to move it. Removing a category keeps its conversations in **Uncategorized**.

Open a conversation to see a concise **Summary** above its turns. It reuses the existing background summary without another model call, prioritizing topics, decisions and next questions in up to three brief points. Preparing or unavailable summaries use short neutral messages; generic capture diagnostics are not displayed. Capture metadata remains internal, and interrupted/missing text stays identifiable in the individual turns.

An empty completed transcription is not a missing final event. Harmless idle-cancellation and tagged End empty-buffer errors do not count as transcript loss. Interrupted output is labeled; generated assistant text is not proof that every word was heard. Saving can be delayed or incomplete if the database, event observer, or network fails. Queues/retries are bounded, and a process crash can lose uncommitted turns.

Transcripts expire automatically after 30 days. Open a conversation’s **···** menu and click **Delete conversation** to review a confirmation, then **Delete permanently** to remove its text and summary, or **Cancel** to keep it. A capture diagnostic never prevents deletion. The backend blocks deletion only while voice/setup is actively using that conversation or its capture is finalizing; unrelated old conversations remain deletable during voice. The UI always saves new transcripts. The internal API still supports saving-off sessions for tests/future controls: no new durable transcript or summary is created, while explicitly selected history can still load. The database and credentials are ignored by Git. Existing sessions cannot be retroactively captured.

### Selected conversation memory

New conversations start with **no saved memory**. Open **Saved conversations**: each existing row has a checkbox under **Load into next conversation** on the right. Check/uncheck individual conversations, or click **Select all** beside BQ (or another category) to bulk-select that group. Click **Clear all** to unselect that category’s conversations, or **Clear selection** to start fresh. There is one grouped list for browsing, category management, transcripts and memory selection. Titles stay left; row controls stay right in the same compact row at desktop and phone widths. Delete is in each row’s **···** menu. Empty categories are hidden from the browsing list and remain manageable through **+ Category**.

Ready selected summaries load automatically after a short debounce; there is no separate memory picker or Load step. The count shows loading/ready/needs-attention status. **Selected insights** expands to show the exact included points and coverage warnings. Start stays visually stable while selection loads. If clicked before the chosen summary packet is ready, session setup loads/revalidates that selection before requesting microphone access. Loading failure stops setup rather than starting without selected memory; none selected starts without context. Selection stays on the page until cleared/reloaded, and is fixed during voice. After End a fresh preview is loaded for the next session. This UI does not inject sources midway through a call.

Bulk selection can include the whole displayed category, including more than three conversations (up to the archive list’s 100-item bound). Bulk selection includes ready, nonempty summaries; unavailable rows remain unchecked with a visible reason, and mixed category headings show how many are ready to load. Empty conversations do not block ready conversations in the same category. Pending summaries show their status; an ended nonempty conversation with a missing/failed summary has an explicit **Prepare summary (API usage)** action. Ready-summary selection makes no new model call. The combined context remains bounded to 6,000 UTF-8 bytes, with whole-point omissions disclosed. If every selected source cannot contribute within that budget, setup is blocked with an error; select fewer conversations. Full transcripts and unselected conversations are not included.

Both the memory selection and microphone-filter choice are local to the page. Reloading clears selected sources and resets the filter to Laptop microphone; a new voice session also resets pacing overrides. No archive or preference is automatically loaded from browser storage.

Previews expire after five minutes; the oldest unused preview may also be replaced after repeated selection changes. Active session reservations remain protected. **Retry** reloads an expired/failed selection. Source changes/deletion require revalidation. Summary wording can be wrong, so review Selected insights when accuracy matters.

New saved sessions prepare a compact background summary after the final transcript drain. Existing untitled ended conversations are queued automatically in bounded batches, with exhausted retries left exhausted. One structured response includes both a short title and evidence-linked summary points; no separate title model or request is added. Summaries use `gpt-5.6-terra` with reasoning disabled through the Responses API with `store: false`; this adds API usage and follows the provider's retention controls. Jobs run separately from voice, recover after restart, and retry at most three times automatically. Summary wording can still be inaccurate.

A long transcript is split into bounded sections and merged. Each job processes at most the latest six sections (24,000 UTF-8 bytes of input each), plus one merge request; limited coverage is labeled. It has a 90-second overall deadline and 30-second per-request deadline. Unfinished, interrupted and unordered turns are excluded; missing speech is never reconstructed. Summaries are reused while their source revision is unchanged.

The context cap is a content-size limit, not an exact token count or a limit on the subsequent live conversation. History loads once at startup, before the microphone is unmuted, after acknowledgment from the provider. If history cannot be read or loaded, setup stops and releases media instead of silently losing continuity. The injected archive is not copied into the new transcript. Deleting a source used by active voice/setup is blocked until that session ends. With saving off, a transient server handle protects those sources, but no transcript observer or durable new conversation is created.

Summaries are stored in the same ignored SQLite database and expire or are deleted with their source session. The app does not infer permanent learning notes, retrieve unselected sessions, or automatically roll over the 45-minute voice session.

New conversations start at **Everyday pace** (`semantic_vad`, `eagerness: medium`). Clear live activity requests such as “mock interview me,” “help me learn distributed systems,” or “let me explain my system design” select **Thinking pace** (`low`). “Let’s just chat” returns to everyday pace. The app uses conservative English/Mandarin phrase matching on finalized user speech, not a separate model classifier; unfamiliar wording can be missed, and technical keywords alone do not switch the pace. The selected activity persists across follow-up turns.

Voice overrides take priority: **“give me more thinking time”** locks thinking pace; **“use normal conversation”** locks everyday pace; **“use automatic turn-taking”** releases the override, retaining the current pace until another clear activity request. Mandarin equivalents include “给我更多思考时间,” “恢复正常对话,” and “恢复自动模式.” The live pace indicator reflects the provider’s acknowledged setting, with automatic/voice-override status. Changes wait until detected user speech, response generation and audio playback are inactive; they affect subsequent turns. A rejected/timed-out pacing request leaves voice running and shows a retry message.

Everyday replies are prompted to stay within one or two short sentences. Learning explanations may expand in manageable pieces, while mock interviews favor a concise question and time to answer. This is prompt guidance, not a hard speech-duration bound. Pacing depends on live input transcription, already enabled for the UI’s saved sessions; transcription failures or the internal no-save path without input transcription leave the existing pace unchanged. Archived history and assistant speech do not select pacing, and preferences reset for each new conversation. Nothing new is persisted and no extra classifier request is made.

Input audio now uses explicit provider noise reduction before speech detection, in addition to the browser’s requested echo cancellation and noise suppression. Before starting, choose **Laptop microphone** (the default) or **Earbuds / headset** under **Microphone noise filter**. Match the microphone selected by your browser; this control adjusts filtering and does not select an audio device. Laptop uses the provider’s far-field profile; earbuds/headsets use near-field. You can switch before each new call without editing `.env` or restarting. The control is fixed during a call and resets to Laptop microphone on page reload. Both profiles preserve automatic replies, natural speech interruption and dynamic low/medium pacing. There is no added interruption timer or word-count gate, and no transcription model change. Filtering can affect quiet speech; actual typing rejection and bilingual/quiet-speech quality require a listening check.

Turn detection estimates whether you have finished and can respond during a thinking pause; it does not guarantee a fixed delay. Start a new conversation to pick up these changes. A manual “done speaking” mode remains planned in V05.

## Providers and BrainShuffle

Voice and summary providers are separate Python interfaces. `VOICE_PROVIDER` and `SUMMARY_PROVIDER` default to `openai`; `SUMMARY_MODEL` defaults to the existing `gpt-5.6-terra`. Existing `backend/.env` files work unchanged. The OpenAI adapter owns credentials, model request schemas, SDP exchange, sideband connections and event normalization. Core archive, history, category and summary-job services do not call OpenAI directly. Only OpenAI is implemented today; another provider needs a tested adapter. The browser transport is also isolated behind a protocol adapter; a provider with a different voice protocol needs its corresponding browser adapter, rather than just a new URL.

BrainShuffle support is prepared against its existing local problem API. Set `BRAINSHUFFLE_URL=http://127.0.0.1:8000` only when you want to use the read connector. `GET /api/integrations/brainshuffle` reports configuration without contacting it. `GET /api/integrations/brainshuffle/problems/{id}` reads a specific problem’s title, prompt, tags and companies, omitting hidden solution notes. `GET /api/conversations/{id}/export` provides a versioned conversation handoff with the current summary, turns and uncertainty metadata. These are API capabilities; there is no new study-picker UI, automatic history injection from BrainShuffle, write-back or shared database. A destination importer and explicit review flow are required before sending summaries/grades back.

See [the migration and parity contract](docs/PYTHON_BACKEND.md) for extension points, limits, verification and rollback. The pre-migration archive and original backend reference are backed up under ignored `backend/data/migration-backup/`; they contain private runtime data and must stay local.

## Verify

```sh
make check
```

This runs browser correctness/React-hook linting, TypeScript checks, Python lint/format checks, browser lifecycle tests, Python API/provider tests, SQLite persistence/reopen/lock tests, the Vite build, and Python wheel/source builds. Legacy transcript/repository oracle fixtures also check the Python port against the previous TypeScript behavior. Tests use disposable synthetic data and make no paid API calls. A passing result does not establish audible speech, bilingual quality, latency, real sideband/transcription delivery, or real browser microphone cleanup; those need live/manual checks.

For microphone/noise acceptance, use the actual browser input device and its matching filter, ask for a short reply, and type silently while it plays. Then interrupt by speaking, and check a quiet Mandarin/English sentence. Repeat with earbuds and the headset filter. Record unintended cuts and missed words; passing offline checks does not establish noise rejection. Additional synthetic listening cases are in [conversation-scenarios.md](docs/conversation-scenarios.md).

For a selected-memory check, save a short conversation containing a distinctive fact, wait for its summary, check its Load into next conversation box in Saved conversations and review Selected insights, start another session, and ask about it. Also start with none selected and confirm no archive context is supplied. Confirm microphone tracks stay muted until history is acknowledged. The internal saving-off path is covered by fixtures: previous history loads without a new archive entry. Check an empty archive and unavailable storage. Automated fixtures and previous synthetic provider checks do not establish spoken recall or audible timing.

For a bounded saving check, start a new saved session, speak a short bilingual exchange, interrupt one reply, then End. The microphone and playback stop immediately. Saving shows **Finishing final transcript** while the observer accepts late events for up to 12 seconds; the client closes the remaining transport by 15 seconds. Received turns keep saving independently. Refresh Saved conversations and check ordering, final words, interruption markers, and save status. Missing finalization remains incomplete rather than being reported as a complete save. The internal API saving-off exclusion is checked with disposable fixtures; the UI always saves. Do not use a full 45-minute run as the first verification.

Run the backend alone with `make backend`, or the web client with `make web-client`. For focused checks, use `npm --prefix web-client run lint`, `npm --prefix web-client run typecheck`, `npm --prefix web-client test`, `uv run --directory backend --locked pyrefly check`, and `uv run --directory backend --locked pytest -q`. `make build` produces `web-client/dist/` plus Python packages in `backend/dist/`. Restart the backend after Python or environment changes; it does not reload active voice automatically. Use one API process; multiple Uvicorn workers are unsupported while setup handles and context reservations are in memory. The documented launch workflow is the local dev server, not a production deployment.

Pyrefly is configured in `backend/pyproject.toml` to use `backend/.venv/bin/python`, the Python source under `backend/src/`, and `backend/tests/`. Pydantic is a direct Python dependency. `make check` includes the full Pyrefly check. If an editor retains old missing-import diagnostics after the folder move, restart its Python language server or reload the window; select `backend/.venv/bin/python` if it asks for an interpreter. Configuration follows [Pyrefly’s documented interpreter and search-path settings](https://pyrefly.org/en/docs/configuration/).

If your personal npm configuration returns an authentication error for these public packages, try `npm --prefix web-client --userconfig=/dev/null --registry=https://registry.npmjs.org ci`. This does not modify your global npm settings.

## Repository layout

```text
voxa/
├── web-client/              # React/Vite application and npm tooling
│   ├── src/               # UI, voice lifecycle, provider adapter and shared types
│   ├── package.json
│   └── vite.config.ts
├── backend/               # Python project and uv tooling
│   ├── src/               # API, services, storage, providers and integrations
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
