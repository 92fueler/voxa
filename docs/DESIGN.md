# Voxa: personal voice learning companion

Status: current implementation reviewed against source on October 18, 2026. The single-user local app uses React/Vite plus Python/FastAPI and direct OpenAI WebRTC audio. The UI always saves transcript text, prepares background titles/summaries, and lets the user explicitly select summaries for a new conversation. Dynamic pacing, live user captions and microphone-specific noise filtering are implemented. Offline and synthetic browser checks do not establish live audio quality, reliable noise rejection, final-transcript completeness or spoken recall. See [PLANS.md](PLANS.md) for evidence and pending acceptance.

Original research and pricing baseline: October 16, 2026. Product targets and future features are labeled below; implementation descriptions reflect the October 18 source review. Published pricing examples are historical research inputs, not a refreshed quote or measured app cost.

### Current implementation boundary

- Local-only browser/API on 127.0.0.1:4317/4318; Python 3.12+ with uv, Node.js 22.13+ with npm, root Makefile orchestration, one API process.
- Start, End, mute, bounded setup/session timeouts and resource cleanup. Default voice model gpt-realtime-2.1, Marin voice, 45-minute default. No automatic reconnect or rollover.
- Laptop microphone or Earbuds / headset noise filtering, selected before Start; semantic VAD starts at everyday/medium, with conservative finalized-speech matching and voice overrides for thinking/low. The filter does not choose the physical audio device. No manual end-of-turn mode yet.
- Six recent user live-caption items, with provisional drafts and exact final replacements. Provider audio understanding and input transcription are separate; captions do not establish persistence or heard-word alignment.
- Automatic local transcript saving, grouped archive/category management, compact summary display and explicit summary-only memory selection. No sources are selected by default. The internal API retains a saving-off path; the UI has no saving toggle.
- No scored teaching modes, post-session grading, permanent learning notes, usage/cost ledger, raw-audio recording, cross-device sync or mobile-background guarantee. BrainShuffle has API preparation only.

## 1. Product goal

Voxa helps the user learn and express ideas through spoken conversation. The primary interaction is **audio in and audio out**: the user speaks, hears a reply, asks follow-up questions, and can interrupt the assistant. Reading and typing should be optional during a session.

The planned learning modes are (the current app has one basic voice-conversation flow):

- **Teach-back:** the user explains a concept; Voxa identifies gaps, tests assumptions, and asks focused follow-up questions.
- **Mock interview:** Voxa asks interview questions, waits for the user's answer, and challenges trade-offs. Detailed assessment comes after the interview rather than interrupting every answer with tutoring.
- **English expression:** the user speaks Mandarin, English, or a mixture; Voxa offers a natural English expression and invites the user to practice it.
- **Guided learning:** Voxa teaches through short questions, examples, and exercises, adapting to the user's responses.

Across modes, favor concise spoken replies, one question at a time, time to think, and explicit uncertainty. The user should be able to request Mandarin explanations, another attempt, or a harder question by voice. A future mode selector should provide a predictable fallback; current activity matching changes pacing only.

## 2. Scope and assumptions

The MVP assumes one user, an internet connection, and a laptop browser with a microphone and speaker or headphones. Phone browser support is an early experiment, not a promise of reliable locked-screen operation.

Target scope beyond the current implementation boundary above:

- Start/end, mute, interruption handling, connection status, and a manual end-of-turn control.
- The four learning modes and Mandarin-English conversation.
- Optional transcript display, session review, and selected learning memory.
- Per-session usage records and application-controlled session budgets.

Defer hardware integration, continuous always-on listening, offline inference, multi-user accounts, subscriptions, a learning-management system, and calibrated pronunciation or mastery scores. Cross-device use and background mobile audio may require a later deployment or native client decision.

## 3. Architecture decision

**Start with OpenAI Realtime speech-to-speech over WebRTC.** One model handles audio understanding, conversational reasoning, and spoken responses. This is a good fit for validating whether the companion feels useful in conversation.

Alternatives remain open:

- A speech-recognition → text-model → speech-synthesis pipeline makes intermediate text inspectable and each component replaceable. It adds coordination work for streaming, cancellation, and interruptions; it could become attractive if measured cost or reasoning-control requirements justify it.
- GPT-Live separates the spoken interaction from a delegated reasoning backend and supports conversation while that backend works. Revisit it if concurrent conversation and substantial backend reasoning become a central requirement.

These are distinct architectures with different billing and state behavior. They should not be treated as interchangeable model settings. See the [official voice architecture comparison](https://developers.openai.com/api/docs/guides/voice-agents).

### Implemented components

```mermaid
flowchart LR
    User[Microphone and speaker] <--> Client[React browser]
    Client <-->|WebRTC audio and data events| Realtime[OpenAI Realtime]
    Client <-->|Setup, archive, summary preview, save status| Backend[Python FastAPI]
    Realtime -->|Owned-call sideband events| Backend
    Backend -->|Bounded save queue and SQLite worker| Store[(SQLite)]
    Store --> Summary[Durable background summary runner]
    Summary <-->|Structured title and summary request| Text[Summary provider]
    Summary --> Store
```

- **React/TypeScript client:** voice controls and resource lifecycle, microphone noise profile, dynamic pacing, ephemeral live captions, grouped archive/transcript viewer and explicit memory selection.
- **Python/FastAPI backend:** provider credentials and SDP exchange, capture ownership, bounded background persistence, context previews/reservations, categories, summary jobs and optional local-app API boundary.
- **SQLite:** conversation/turn records, categories, revision-bound titles/summaries, durable summary-job state and deletion tombstones. Writes use one dedicated worker thread.
- **Separate voice/summary providers:** OpenAI is implemented; voice defaults to gpt-realtime-2.1 and summaries to gpt-5.6-terra. A learning evaluator, learning-note store and usage accounting remain planned.

The browser sends audio directly to OpenAI. The backend need not proxy the audio stream. Permanent API credentials stay on the server. Saved sessions use a one-use browser setup handle: the backend exchanges SDP with its own temporary credential and obtains the call ID directly from the provider response before attaching the sideband observer. This avoids accepting an arbitrary client-selected call ID. Sessions with saving off use a temporary browser credential when there is no history; when history is present they use a transient backend setup handle without a transcript observer or content writes. Both use direct WebRTC for ongoing audio. The sideband observes the same Realtime session, not a second AI conversation or a separate Codex chat. Sources: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime).

Voice and persistence are separate asynchronous tasks within the application. Neither database acknowledgments nor transcript finalization should gate microphone transport, playback, or response generation. The implementation uses a dedicated Python worker thread for the synchronous standard-library SQLite API, keeping database locks off the API/event loop. Calling a blocking database operation from an async function does not make it nonblocking.

Use the Realtime SDK as a possible session-management wrapper; retain explicit application ownership of persistence and learning behavior. No additional orchestration framework is needed for the proposed MVP.

### Python and provider boundaries (October 17 migration)

The repository groups web source/npm tooling under `web-client/` and Python source/uv tooling/environment/data under `backend/`, with root `Makefile` commands. The implementation separates the FastAPI HTTP contract, application services, SQLite repository, model-provider adapters and local-app connectors. VoiceProvider and SummaryProvider are independent ports; OpenAI is the initial concrete implementation. Provider-specific credential formats, URLs, request schemas, sideband connections and transcript wire normalization stay in that adapter. Browser protocol details live in a matching transport adapter. A provider with a different audio transport requires an additional browser adapter; changing an environment variable alone is insufficient. No orchestration framework, extra service, vector database or distributed queue is added.

BrainShuffle remains an independent application. An optional loopback HTTP connector reads its actual `/api/problems/{id}` schema, and a versioned Voxa export prepares the return-data boundary. No database sharing, automatic summary upload or grading is introduced. The existing UI behavior and schema-v4 archive remain the migration baseline. See [PYTHON_BACKEND.md](PYTHON_BACKEND.md) for the concrete parity contract and extension workflow.

## 4. Session lifecycle

1. Optionally select saved summaries in the unified Saved conversations list and choose a microphone noise-filter profile matching the browser's actual input device. Nothing is selected by default; no mode selector is present.
2. On Start, reuse the current preview token or load the exact selected summary IDs before requesting microphone access. Unavailable or invalid selected context stops setup; no selection starts with no archive context. The preview itself is assembled from stored summaries without a new model request.
3. Acquire the microphone with echo cancellation/noise suppression requested and keep its tracks disabled through setup. POST /api/session sends saving enabled, the microphone profile and an optional context token. The backend validates selected revisions and issues a one-use setup handle for saved/context sessions; the internal no-save/no-context path returns a temporary credential.
4. Exchange SDP through /api/call for a backend-owned call, attach the saved-session observer and establish browser WebRTC. Insert selected history once with its bounded context item ID; keep the microphone muted until conversation.item.done acknowledges that exact item. Only then show connected/listening and enable capture tracks.
5. Converse using the provider's direct audio path. Browser captions/pacing and backend transcript normalization observe events independently; neither live caption display nor successful playback proves the transcript was saved.
6. On End or failure, stop microphone capture and playback immediately. Normal End allows a bounded final transport/observer drain and saving of already-received turns. A durable summary/title job runs separately after final capture; it is not a learning assessment.
7. The selected source IDs stay on the page for the next call, with a fresh preview after End. Reloading clears the selection and resets microphone/pacing preferences. There is no automatic reconnect, context retrieval, grading or session rollover.

Mute, disconnected and ended are distinct states. Network failure releases media and requires the user to start again. The app defaults to a 45-minute session timer (configurable 30–2700 seconds), including connection time; it is a safety bound rather than an exact spending guarantee. Saved context setup fails closed, and startup rejects context returned without explicit selection. Future replacement-session continuity is covered by V18; current UI memory includes summaries only.

Current live-text display (October 18): an ephemeral browser view shows the six most recent user speech items from existing data-channel transcription events. Drafts are provisional and replaced by exact finalized provider text; missing finals remain unconfirmed. No transcription model, turn-detection timing, backend archive semantics or extra audio/model request is introduced. Drafts never enter history or pacing decisions. The archive stays authoritative for retained conversations and late finalization. This improves display latency only; provider transcription latency and bilingual accuracy still require live checks.

## 5. Latency and turn-taking

Measure two user-visible behaviors separately:

- Time from the user's last spoken word to the first audible assistant response.
- Time from the user beginning an interruption to assistant playback stopping.

Also record detected turn end, first response/audio events, and client playback start. This separates turn-detection waiting from remaining model, network, and playback delays. Streaming stages overlap, so individual timings should not be blindly added together.

Initial product targets for ordinary conversation are a median last-word-to-reply delay of at most 1.5 seconds, a 95th percentile of at most 3 seconds, and a 95th-percentile interruption stop delay of at most 300 milliseconds. These are acceptance targets, not published provider guarantees or measured results. Deep reasoning and deliberately patient turn-taking need separate reporting.

Current input-noise policy (October 18): configure provider input noise reduction explicitly before VAD/model processing, defaulting to far_field for laptop/room microphones. A Microphone noise filter selector offers Laptop microphone and Earbuds / headset (near_field), applies to each new session, and is disabled during connecting/connected voice. This selects filtering rather than the physical input device; the user must match their browser-selected microphone. Choice is page-local, resets to laptop on reload, and needs no service restart. The API validates a laptop/headset enum; the OpenAI adapter owns mapping to wire profiles. Retain browser-requested echo cancellation/noise suppression, semantic low/medium pacing and automatic barge-in. Pacing session updates touch only turn_detection so the noise filter remains unchanged. Do not add an unsupported semantic-VAD threshold, gate interruption on delayed transcription, or suppress quiet speech with an unmeasured volume cutoff. Filtering is mitigation for false speech starts, not proof of noise immunity; verify keyboard-only input, genuine interruptions and quiet/bilingual speech with the actual microphone. [Input audio configuration](https://developers.openai.com/api/reference/resources/realtime/client-events)

### Proposed turn policy

- Teach-back and interviews: begin with semantic voice activity detection (VAD) at low eagerness.
- Short English practice: begin with medium eagerness.
- Provide a manual “done speaking” control for pauses that automatic detection handles poorly.

Current basic-conversation tuning (October 18): conversations start at medium semantic eagerness. Conservative matching of clear learning/interview activity requests in finalized live user speech switches to low; clear casual-chat requests return to medium. Explicit spoken pacing overrides stay locked until automatic turn-taking is requested. Changes wait for speech/generation/playback to be inactive and are shown only after provider acknowledgment. The browser owns this transient pacing preference; archived/assistant text does not control it. No separate classifier call or durable preference is added. Everyday replies stay brief; technical learning can expand and mock interviews ask one question at a time. This is a phrase-based MVP, not general semantic activity recognition or the full learning-mode implementation. Audible switching, latency and pause tolerance still require human verification.
- Allow interruptions and keep replies short enough that the user remains an active participant.

The manual fallback is an explicit interaction mode, not an extra button layered over automatic replies. It must gate automatic response creation and trigger one response only when the user indicates completion. Test switching between automatic and manual policies without duplicate replies. Prompting the assistant to wait is not a reliable substitute for response gating.

Semantic VAD estimates completion using the meaning of speech; silence-based VAD uses pauses. Lower eagerness allows more time to speak. Neither can guarantee that a thinking pause means the user is finished. Test with the user's actual speech patterns. [VAD documentation](https://developers.openai.com/api/docs/guides/realtime-vad)

Keep comprehensive grading, memory extraction, and unnecessary database reads outside the spoken response path. Preload relevant learning context at session start. Allow a slower, acknowledged check when technical correctness requires it. Higher reasoning effort can increase latency and output token usage. [Realtime model documentation](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)

## 6. Model choice and cost

Use the full Realtime model as a quality reference, then compare Mini on identical tasks. Mini is the proposed everyday default only if it meets requirements for misconception detection, bilingual understanding, and coaching behavior. A cheaper model that confidently validates incorrect explanations would undermine the product.

Run a small model-quality comparison after the voice foundation and first two learning modes, before building persistent learning memory. Repeat a broader comparison later for long sessions. A poor conversational foundation should change the design early.

Research baseline recorded October 16, 2026, USD per million tokens (not refreshed in this code/documentation sync):

- **gpt-realtime-2.1-mini:** new input $10; cached input $0.30; output $20.
- **gpt-realtime-2.1:** new input $32; cached input $0.40; output $64.

At approximately 600 user audio tokens and 1,200 assistant audio tokens per speech minute, the fresh-audio baseline for 30 minutes of user speech plus 30 minutes of assistant speech is **$0.90 Mini** or **$2.88 full**. At 30 minutes daily for 30 days, assuming equal speaking time and no silence, this becomes **$13.50 Mini** or **$43.20 full**.

These are arithmetic baselines, not complete invoice forecasts. Each response can process prior conversation context; later turns can therefore cost more. Input transcription, when enabled, has a separate charge. Include text/reasoning usage, evaluation, tools, and hosting as applicable. Cache reuse is best-effort. Sources: [pricing](https://developers.openai.com/api/docs/pricing), [voice cost accounting](https://developers.openai.com/api/docs/guides/voice-latency-cost).

For comparison, the October 16 research recorded GPT-Live voice duration at $0.05 per active minute, or $45 for 900 monthly minutes, plus backend usage. Its duration billing includes silence and backend waiting. This estimate must not be substituted for Realtime token billing. [Pricing](https://developers.openai.com/api/docs/pricing), [duration accounting](https://developers.openai.com/api/docs/guides/voice-latency-cost)

### Proposed usage accounting and controls

Usage/token records and cost reporting are not implemented. Only the bounded session timer exists today.

Persist response-level usage with the model, prompt version, session ID, and a versioned rate card. Price uncached and cached input separately; do not charge cached tokens again as uncached input. Reconcile reported reasoning usage according to the selected model's accounting rather than adding it twice.

Track transcription and evaluator usage separately. Record interrupted/cancelled responses too; audio heard by the user is not a sufficient billing measure. Report incomplete usage as incomplete rather than zero.

Provide a configurable session duration and estimated-spend threshold, and close sessions when the user ends them. Application checks limit exposure but should not promise an exact invoice cutoff: in-flight work and delayed usage reporting can create an overshoot.

Compare 5-, 15-, and 45-minute sessions, cost per useful learning session, and cache behavior. Do not extrapolate a complete monthly bill from one short exchange.

## 7. Conversation storage and learning memory

Persistent storage is not required for an isolated voice conversation. It is useful for session review, next-day continuity, debugging feedback, and tracking what to practice.

Current increment: the UI always saves transcripts automatically at the user's request; the redundant saving checkbox was removed. SQLite stores transcript turns under `backend/data/`, with no raw-audio recording. The viewer supports concise titles with dates, refresh, per-row overflow-menu deletion with confirmation, and manual categories. Compact category headings have contextual rename/remove menus; + Category opens creation and empty-category management; reaching the 50-category limit disables creation without hiding management. Dense history rows place titles and shortened dates together when space permits. The voice area contains voice controls, the microphone noise filter, pacing/save status and ephemeral user captions; storage, memory and API usage details live in a collapsed footer section. One category groups related conversations in history; removing a category preserves its conversations. Category changes do not alter transcript revisions or summary evidence. Generic capture diagnostics are not displayed in the transcript viewer. A compact Summary paragraph reuses whole points from the current saved summary above the individual turns; diagnostic metadata remains internal and actual saving errors remain actionable. Expired transcript content is removed on history access after 30 days. Pinning, learning notes, and automatic model-session rollover are still proposals below; no-save sessions perform no conversation-content writes.

Deliver basic transcript saving before automatic learning-memory extraction. The archive preserves what was captured; the model knows past content only when the application explicitly supplies selected history or retrieval results. Saving turns does not train the model, automatically restore a new provider session, or require a learning-quality evaluator.

Future retention extensions (current transcript and summary retention is 30 days together):

- **Finalized transcript turns:** 30 days, with explicit pinning for sessions worth keeping.
- **Session summaries and learning notes:** until removed or superseded; retain only compact observations and minimal provenance after source-transcript expiry.
- **Usage and timing metadata:** 90 days.
- **Raw audio:** no recording feature in this MVP. Explicitly selected practice clips are a possible later feature.

Transcripts support wording and conceptual feedback. A transcript cannot preserve pronunciation or intonation evidence; those features require audio and separate quality evaluation. Do not present pronunciation scores as calibrated measurements.

### Future conceptual records beyond the implemented archive

- **Session:** application ID, provider-session identities, mode, topic, start/end, model, prompt version, transcript revision, connection outcome, and review status.
- **Turn:** application ID, provider session/item identity, speaker, ordering relationship, finalized text, timestamps, and interruption/incomplete markers.
- **Review:** source transcript revision, summary, strengths, possible misconceptions, useful English expressions, suggested exercises, and supporting turn IDs.
- **Learning note:** topic, observation, source session/turn IDs, tentative/resolved status, last-reviewed date, and suggested next practice.
- **Usage:** response ID, token categories and cache details, separate transcription/evaluation usage, estimated cost, and accounting completeness.

Treat a learning note as evidence-backed guidance, not an unquestionable fact about the user. Distinguish a direct statement from evaluator inference. Allow correction and removal. An uncertain transcript must not silently become a permanent weakness label.

### Persistence behavior

Save finalized turns incrementally; do not wait until session end to save everything. Match events by item ID and preserve conversation ordering rather than assuming arrival order. Deduplicate retries. Partial transcript text is a display aid until finalized, and incomplete sessions remain reviewable with that limitation marked.

Input transcription is asynchronous and is an approximation of the audio, not exactly what the speech model understood. Preserve that distinction in review and memory. Use a bounded finalization deadline; a late event must not be attached to the wrong session or quietly alter a completed review. [Input transcription reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)

Mark interrupted assistant output as incomplete. WebRTC truncates unplayed audio in live context, but the API does not supply a precisely aligned truncated transcript. Do not promise an exact record of words heard. Conservatively exclude uncertain assistant text from claims about delivered teaching, and retain an interruption marker instead. [Interruption handling](https://developers.openai.com/api/docs/guides/realtime-conversations)

### Capture and background saving

Prefer backend sideband capture for long conversations and walking use, reducing reliance on browser event forwarding. Associate the provider call with a server-issued application conversation before attaching. Keep the permanent key on the backend and verify ownership rather than accepting arbitrary client-supplied call IDs. The documented Realtime WebRTC flow exposes the call ID through the SDP response's `Location` header; verify registration and attachment with the actual browser when implementing. Attach early, and mark an attachment gap as incomplete rather than assuming past events will be replayed. A sideband does not keep the primary audio connection alive when the browser or network disconnects. [Realtime sideband connection](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)

Use one owner for durable transcript writes. The browser may observe the same events for captions/status; it must not independently append duplicate turns. Client-forwarded capture remains a possible smaller fallback, with browser closure and unsent-event loss explicitly documented. Do not switch event owners silently during failures.

The implemented save flow is:

1. Receive transcript events and normalize speaker, item identity, ordering, finalization, and interruption state. Enable input transcription for saved sessions; do not route live replies through transcription. Transcription has separate usage charges.
2. Enqueue finalized turns or later revisions with a key containing application conversation, provider session, and item identity. Event callbacks do minimal work and never await a database commit before voice can proceed.
3. A background writer commits small transactions to SQLite and acknowledges saved revisions. Retry transient failures with bounded backoff; duplicate delivery must update the same record rather than append a second turn. Reject stale revisions and writes for deleted conversations.
4. Expose saving, saved, delayed, and incomplete status independently of voice connection state. Record bounded, sanitized capture reason codes and show saved-turn counts. Expected idle cancellation and an empty-buffer error correlated to our final End commit are cleanup outcomes; do not flag them as transcript loss. Unexpected provider errors and missing final text/order remain warnings. Preserve older unknown flags rather than guessing the cause. Sideband or database failure must not close an otherwise healthy voice session. Bound the queue by count/bytes and retry time; if limits are reached, mark a save gap and stop accepting additional content for persistence until recovery instead of growing memory without limit or silently claiming success.
5. On End, release microphone and playback immediately. A saved conversation remains alive independently of its voice state: show finalizing, accept late observer events for up to 12 seconds, and close the remaining client transport by 15 seconds. If input was still active, make a best-effort final input commit without requesting another model response. A completed empty ASR result is distinct from a missing final event; it can mean no speech was recognized, so it does not by itself create a pending-finalization warning. Keep placeholder records for detected but unfinished input turns, so a missing ASR completion cannot silently look like a complete capture. Finish saving already-received turns independently of transport closure. Late events stay bound to their original provider session, and deferred cleanup must never affect a new session. These deadlines are initial implementation choices, not measured ASR guarantees. Pending in-memory content can be lost on process failure; only committed data is durable. No-save sessions bypass the durable queue and content writes.

Verify this separation with slow/locked/unavailable storage, sideband loss, duplicate/out-of-order events, queue exhaustion, and End during a pending write. Compare spoken-response timing with saving enabled and disabled under an authorized bounded trial; architectural separation is not proof of zero latency impact. Do not claim complete transcripts when events are missing.

Persistence rollout must preserve an already-running conversation: do not refresh the browser, hot-reload its voice controller, or restart its services to install saving while the user is speaking. Enable capture on a fresh session after the current conversation ends. Previously unsaved speech cannot be recovered retroactively.

Future learning review must run only on a clearly identified transcript snapshot. Store review status and make retries idempotent. A simple backend task is enough initially; a separate queue service is not required by this design.

The current continuity increment (V25–V27) adds separate consumers of saved turns. After the durable End operation, a claimed SQLite summary job runs one at a time, using a 90-second deadline and at most three attempts. The job summarizes at most six 24,000-byte sections and one merge with `gpt-5.6-terra` (reasoning disabled); source references are validated and partial coverage is labeled. The same response produces a short title in the conversation’s main language, with source turn references and an 80-character cap. Multi-section jobs choose the final title in the existing merge request. Titles are revision-bound metadata in the summary JSON; they never replace transcript text. The background runner automatically queues ended untitled records, including legacy summaries, in batches of up to 100; an exhausted current job is never reset by polling. Listing history does not schedule work. A bounded opening excerpt labels a conversation immediately until its model title is ready; transcript text is unchanged. A new selected source revision invalidates earlier summary results. Summary failures never gate active voice. Summaries currently share their source's 30-day expiry/deletion policy; indefinitely retained learning notes below remain a future policy.

At Start, no saved context is supplied unless the user explicitly selected sources; a ready preview may be reused or setup prepares the exact selection before microphone acquisition. The unified Saved conversations list provides individual checkboxes under one Load into next conversation column header and per-category bulk selection. Shared grid columns align the selection header, category bulk controls and checkboxes; titles remain left and controls right, including phone widths. Delete lives in a row overflow menu. Empty categories remain manageable through + Category without occupying the browsing list. Category bulk selection includes eligible ready summaries; visible row reasons and ready counts explain exclusions, so empty conversations do not block the group. It automatically loads selected current, nonempty ready summaries and optionally shows Selected insights, with whole insight points under 6,000 UTF-8 bytes. There is no separate picker/Load step. Bulk selection supports the displayed archive (up to 100 sources), but fails rather than silently dropping a source that cannot contribute within the context budget. The Start button remains visually stable while summaries load; a Start without a ready preview loads the exact selection before acquiring microphone access and fails closed if loading fails. No raw/recent transcript excerpt fallback is used by this UI flow; unavailable summaries stay excluded until background preparation completes; failed/missing rows offer explicit preparation, and Start itself makes no summary-model call. Whole-point omissions and capture/coverage warnings remain visible. A single-use five-minute token and revision checks bind the preview to startup. Microphone tracks remain muted until the exact inserted context item receives `conversation.item.done`; errors or timeout release media. The injected item is excluded from the new archive. Sources cannot be deleted while setup or voice uses them, including sessions with saving off. Selection is fixed during voice; changes apply to the next session. Permanent learning-memory inference remains a separate future feature. The explicit API still supports an excerpt-capable preview for compatibility; the unused automatic recent-three loader is removed. Unused preview tokens are bounded to 16 together with active reservations; oldest unused tokens are evicted on new previews, while active reservations cannot be evicted. Both browser preview consumers share exact-selection and summary-only validation, and startup rejects unsolicited archive context. The API supports [inserting text history](https://developers.openai.com/api/reference/resources/realtime/client-events); summary output uses [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), with application validation of source references.

Broader summarization and context restoration remain separate consumers of saved turns. Do not rewrite the active model context on each database commit. At a new session or deliberate continuation boundary, select a compact summary and recent finalized turns within a token budget, preserving uncertainty and source turn IDs. Earlier details can be retrieved by topic or SQLite text search. Do not inject the entire archive into every response.

Persist pending review work so a backend restart can retry it. Before committing a result, check the source revision and whether the session still exists. Deletion or expiry must invalidate affected in-flight jobs so their completion cannot recreate removed content. Treat transcript text as evidence, not as instructions to the evaluator.

## 8. Caching and context management

Keep three concepts distinct:

- **Provider prompt cache:** reuses computation for a matching input prefix. It is a cost/latency optimization, not durable user memory.
- **Application learning memory:** stores selected observations and evidence across sessions.
- **Cached answers/audio:** replays earlier output. Reserve this for fixed prompts or deliberate practice clips; personalized coaching depends on current context.

Keep stable instructions and tool definitions at the beginning. Append turns rather than rewriting earlier history. Avoid changing the prompt prefix every turn with timestamps or refreshed summaries. Summarization and truncation can reduce cache reuse. Dropping old context in batches can reduce repeated cache misses, but loses more history at once. [Realtime prompt caching](https://developers.openai.com/cookbook/examples/prompt_caching_201)

Proposed context policy:

1. At session start, select preferences, the current topic summary, and a small number of relevant learning notes.
2. Retain recent dialogue for natural follow-ups.
3. At a topic boundary or before the context threshold, build a compact summary from finalized, eligible turns.
4. Verify the summary and recent turns are available before intentionally replacing old context. Automatic truncation alone does not summarize discarded content. If it occurs first, mark the gap and ask for clarification instead of inventing lost detail.
5. Keep the full retained archive outside the live model context.

Experiment with a 16k post-instruction token budget and retention ratio 0.8, compared with 8k and 32k. These values are starting hypotheses, not requirements. Test forgetting and feedback quality alongside cost. The API exposes a custom conversation-token limit and retention-ratio truncation. [Configuration reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)

For initial memory selection, use explicit topic tags and SQLite search. Add embeddings only if retrieval failures demonstrate a need. Do not rely on an assumed cache lifetime for cross-day continuity; the application owns that memory.

## 9. Privacy and deletion

The internal API supports saving-off sessions with no new durable transcript, summary, review or learning updates; the current UI always saves automatically. Saved context loads only through an explicitly selected preview; leaving memory empty starts without archive context. Permanent personal learning notes remain outside the current increment. Live context can remain in memory until the session ends. Content-free operational metadata such as model, duration, and token counts may be retained; topic names and message content are excluded. Explain that speech still goes to the API provider. Avoid logging credentials or raw audio in ordinary diagnostic logs.

Distinguish automatic transcript expiry from an explicit “delete session and learning” action. Currently, expiry and explicit deletion remove both turns and the source summary and invalidate unused previews; active setup/voice source reservations block explicit deletion. Summary retention beyond transcript expiry is not implemented. A future separate learning-note policy may retain compact observations with unavailable source IDs, subject to V16. Do not preserve verbatim transcript copies in derived records to evade expiry. The review UI must explain that the original evidence is no longer available.

Current deletion requires confirmation and removes the transcript and summary. Clips, learning reviews, dependent notes and pinning do not exist yet; their future deletion/recomputation policies belong to V16.

The current API rejects deletion of a source used by active setup/voice or finalizing capture; the user must End and wait for final saving before deleting it. If future functionality permits deletion of already-injected context, it must also close/replace the affected live context before claiming the companion has forgotten it. Cancel pending writes/reviews or reject their stale completion. Deletion also needs to handle buffered retry events.

Application retention and provider retention are separate. OpenAI states that API data is not used for training by default. Standard abuse-monitoring logs may contain content and are generally retained for up to 30 days, with documented exceptions. Special retention controls require eligibility and approval; this MVP must not claim zero provider retention. [Data controls](https://developers.openai.com/api/docs/guides/your-data)

## 10. Remaining validation before expansion

The remaining controlled evaluations should answer these questions; the initial voice prototype already exists:

- **Model quality:** can Mini and full detect the same deliberately incorrect technical explanations without agreeing too readily?
- **Turn-taking:** can the user pause, say “um,” switch languages, and explain a concept for several minutes without premature replies?
- **English coaching:** does Voxa preserve intended meaning and provide natural expressions rather than literal translations?
- **Latency:** do ordinary replies and interruption handling meet targets across laptop speakers and headphones?
- **Long sessions:** how do cost, cached input, and recall change at 5, 15, and 45 minutes?
- **Recovery:** do disconnection, microphone denial, interrupted output, duplicate events, and failed review produce understandable states?
- **Memory:** can the next session revisit a supported learning gap, and can the user correct or delete it?
- **Mobile:** do foreground use, screen locking, Bluetooth routing, and reconnection meet the desired hands-free experience?

Use identical tasks and prompts when comparing models. Keep a small human-reviewed set of explanations and feedback examples. Evaluate learning quality separately from transcript accuracy and conversational smoothness. No result is established by this document.

## 11. Open decisions

- Monthly testing budget and whether the current 45-minute default needs changing.
- Teach-back is the proposed first mode; English expression follows for the early comparison. The user can change this order before implementation.
- Whether to extend the current 30-day transcript/summary retention with pinning or separately retained learning notes. UI saving is already automatic by user request.
- When to revisit the deferred phone/Bluetooth foreground and locked-screen evaluation.
- How much technical checking should happen during conversation versus after the session.
- Whether backend sideband capture meets transcript completeness requirements on the user's actual browser/device; any client-forwarded fallback must expose its loss limits.

These decisions can be resolved before implementing their dependent features. This document does not authorize implementation or paid experiments.
