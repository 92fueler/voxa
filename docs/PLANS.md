# Voxa development plan

Status: the user accepted the initial voice MVP on October 16, 2026 and subsequently authorized background persistence. V00–V02, V06, and V13 have completed their offline acceptance. V25 continuity summaries have passed scoped offline and synthetic-provider checks. V03–V05 retain detailed live/manual checks. V21 capture/storage wiring and V22 browsing/deletion are implemented with mocked/fixture verification; live capture and broader viewer acceptance remain pending. The 45-minute duration change is a partial V23 increment; usage/spend accounting remains pending. Automatic recent-history continuation is implemented in V25–V27; spoken WebRTC acceptance remains pending. Automatic rollover and learning-memory extraction remain planned. The plan itself does not authorize implementation or paid experiments.

Design source: [DESIGN.md](DESIGN.md). Repository instructions: [AGENTS.md](../AGENTS.md).

## How to use this plan with Codex

Select a step by its stable ID and authorize that scope. Each step should leave an observable result and be reviewable as a focused change. A step is independently **verifiable**, not necessarily dependency-free: the dependencies below identify what must already exist. Do not substitute a large collection of horizontal infrastructure tasks for an early working voice conversation.

For each implementation request:

1. Read the step and dependencies; check their recorded evidence against current code.
2. State the expected behavior and verification approach. Resolve routine implementation choices within scope.
3. Implement the smallest complete change. If a step grows into multiple unrelated outcomes, split it and update the plan.
4. Run relevant checks and inspect the diff. Use fixture tests for deterministic logic and manual/live checks for behavior fixtures cannot establish.
5. Record observed results in the evidence log below. Record failures and skipped checks accurately.
6. Review and, when requested, commit the focused change. A commit is a useful checkpoint, not proof that the acceptance criteria passed.

Work on one step at a time unless a request explicitly covers several. Dependencies do not authorize starting additional steps. Stable IDs are not an execution order; use the dependency order below. A new chat can continue by reading these files; completion state should not depend on remembering earlier chat messages.

Use `docs/DESIGN.md` for the why, this file for the work and evidence, and root `AGENTS.md` for stable repository guidance. Verified commands live in root `README.md`. Avoid copying the entire design into agent instructions.

### Example implementation request

> Implement V03 only. Read AGENTS.md, docs/DESIGN.md, and docs/PLANS.md. Check the dependencies first. Keep persistence and learning modes out of scope. Run available automated checks, report live/manual checks separately, update the plan with evidence, and stop after this step. Do not commit yet.

For live experiments, establish a finite session/time budget before running them and carry already-established authorization forward. Offline tests need no paid API calls. Human listening checks require the user's observation or a suitable authorized audio test; do not infer audible success from a connection event. Define pass/fail criteria and test conditions before observing results.

### Done means

A step is complete only when its stated acceptance checks have evidence, relevant regressions pass, the diff has been reviewed, and limitations are recorded. If code is ready but a required live check is pending, keep the step in progress and identify that check. A failed experiment can be complete as an experiment when it produces valid evidence and a documented decision; it does not count as passing product behavior.

The checklists below are the current status summary. Use unchecked entries plus an evidence-log note for in-progress or blocked work. Check an entry only after completion. Do not invent build or test commands before the chosen tooling exists.

## Progress

### A. Establish a usable voice conversation

- [x] V00 — Define representative conversation scenarios.
- [x] V01 — Add a runnable local scaffold and verification commands.
- [x] V02 — Create server-owned temporary session credentials.
- [ ] V03 — Complete one audio-in/audio-out conversation.
- [ ] V04 — Handle connection failures and resource cleanup.
- [ ] V05 — Tune turn-taking and interruption behavior.

### B. Make quality and operating cost visible

- [x] V06 — Normalize transcript events with offline fixtures.
- [ ] V07 — Calculate usage costs from offline fixtures.
- [ ] V23 — Collect live usage and apply session budgets.
- [ ] V08 — Measure response and interruption latency.
- [ ] V09 — Deliver teach-back behavior.
- [ ] V10 — Add English-expression practice.
- [ ] V24 — Compare voice models before adding memory.
- [ ] V11 — Add mock-interview behavior.
- [ ] V12 — Add guided-learning behavior.

### C. Add continuity and bounded context

- [x] V13 — Add the session repository with a no-save policy.
- [ ] V21 — Connect live transcripts to incremental persistence.
- [ ] V22 — Display saved sessions and transcript limitations.
- [x] V28 — Organize conversations into categories.
- [x] V25 — Generate compact continuity summaries in the background.
- [ ] V26 — Prepare bounded recent-history context automatically.
- [ ] V27 — Load history before the first spoken turn.
- [ ] V14 — Generate evidence-backed post-session review.
- [ ] V15 — Select learning memory for the next session.
- [ ] V16 — Enforce retention and delete derived data.
- [ ] V17 — Bound context and inspect cache behavior.
- [ ] V18 — Restore selected context after a replacement connection.

### D. Validate the MVP and decide on expansion

- [ ] V29 — Migrate the backend to Python with provider ports and a BrainShuffle boundary (implemented; final live voice acceptance pending).
- [x] V30 — Group frontend/backend projects and configure Python editor checks.
- [x] V31 — Audit migration regressions, cleanup and verification gaps.

- [ ] V19 — Validate long-session behavior and the MVP.
- [ ] V20 — Evaluate phone and Bluetooth use.

## Step definitions

### V31 — Audit migration regressions and unnecessary code

**Dependencies:** V29 implementation and V30. **Authorization:** user requested checking regressions/bugs, dead code, lint, duplication and unnecessary complexity. **Provider calls:** none.

**Deliverable:** inspect the actual application paths, reproduce meaningful failures with synthetic regressions, fix confirmed issues, remove genuinely unused helpers, and add browser lint to the existing verification workflow. Preserve the archive/key, provider boundaries and documented API features even when the current UI does not expose an endpoint.

**Verify:** full root checks, targeted race/bounds/shutdown tests, clean npm installation, isolated built-wheel startup, a non-destructive browser smoke check, archive checksums and stopped app services. Do not claim paid/live speech acceptance from fixtures.

### V30 — Frontend/backend folder ownership and Python editor configuration

**Dependencies:** V29 implementation; its separate spoken acceptance can remain pending. **Authorization:** user reported Pyrefly missing Pydantic, then requested grouping frontend/backend files and reducing root clutter. **Provider calls:** none.

**Deliverable:** `frontend/` owns browser source, shared browser types, npm manifests/configuration/dependencies/builds; `backend/` owns Python `src/`, tests, uv metadata/environment, credentials and runtime data. Root contains README, AGENTS, docs, Makefile and Git files. Root `make install/dev/check/build` coordinate the independently runnable projects. Keep the existing key and archive, local ports and behavior. Configure Pyrefly to resolve actual Python sources and `.venv`, and include its full check in verification.

**Verify:** reproduce the original incorrect interpreter/source-root selection; confirm Pydantic in the actual runtime; run full Pyrefly without diagnostic suppression; install from both lockfiles; run both test suites/builds; smoke-test the root launcher/proxy/key/archive; compare retained archive checksums and ensure private files stay ignored. Leave services stopped per the earlier user instruction.

**Outside scope:** visual redesign, new provider/model behavior, BrainShuffle activation or changes to stored conversations.

### V29 — Python backend, provider interfaces and local-app boundary

**Dependencies:** existing V02/V06/V13/V21/V22/V25–V28 behavior. **Authorization:** user explicitly requested stopping the app and rewriting its backend in Python with feature parity, OpenAI as one provider, and readiness for BrainShuffle.

**Independently verifiable increments:**

- [x] Stop the existing app; back up the SQLite archive and original server in ignored local storage.
- [x] Add uv-managed Python/FastAPI runtime and preserve existing `/api` contracts and loopback protections.
- [x] Port persistence, capture/final drain, categories/deletion, automatic continuity and durable summary jobs; compare synthetic outputs to the old implementation.
- [x] Separate voice/summary provider ports and browser wire adapters; exercise core APIs with an injected non-OpenAI fixture provider.
- [x] Prepare a disabled-by-default BrainShuffle problem reader and versioned conversation export against the actual local source contract, without automatic writes or shared storage.
- [x] Verify packaged runtime, unchanged archive and browser startup/history/summary/deletion-confirmation behavior.
- [ ] Complete a short human audio-in/audio-out, interruption, End/final-turn and remembered-history check on the Python backend. Offline checks alone do not establish audible parity.

**Deliverable:** one active Python backend; reproducible setup; migration and capability contract in [PYTHON_BACKEND.md](PYTHON_BACKEND.md). Keep prior documented live-capture limitations rather than claiming migration repairs historical missing speech.

**Outside scope:** new model vendors, BrainShuffle study UI/importer/automatic sync, mobile app, distributed workers or changes to the user’s retained transcript text.


### V00 — Representative conversation scenarios

**Dependencies:** none. **Provider calls:** none.

**Deliverable:** a small synthetic scenario set with expected behaviors: a correct technical explanation, a plausible misconception, a long thinking pause, Mandarin-English mixing, an English retry, and an interruption. Include mode-specific expectations and a simple human review rubric. Use invented examples, not private conversation exports.

**Verify:** each scenario has an input situation, observable expected behavior, and a failure example. Include several incorrect and correct technical explanations so testing is not based on one topic. Name critical failures, including confidently validating a misconception or changing the intended English meaning. Record the intended evaluation profile and rubric before live runs; assess meaning and behavior rather than exact wording.

**Outside scope:** app code, automated model grading, and provider experiments.

### V01 — Runnable local scaffold

**Dependencies:** none. **Provider calls:** none.

**Deliverable:** minimal TypeScript browser and backend projects, reproducible dependency installation, a working local page, and a backend health endpoint. Select one package manager. Document actual install, dev, build, typecheck, and relevant test commands; ignore secrets and runtime data.

**Verify:** the documented setup works from the repository; the page and health endpoint load; build/typecheck pass. No API key is required and no provider call occurs. A meaningful health-endpoint smoke check is enough initially; do not add tests for static placeholder copy.

**Outside scope:** voice integration, database, deployment, polished UI.

### V02 — Temporary session credentials

**Dependencies:** V01. **Provider calls:** not required for automated verification.

**Deliverable:** backend-only permanent key configuration and a session-credential endpoint. Pin supported session defaults and return only what the client needs. Missing configuration and provider failures have explicit outcomes. Keep the local MVP endpoint local; remote exposure would need its own access-control decision.

**Verify:** mocked provider success, missing key, rejection, and timeout cases; the permanent key is absent from the client build, responses, and logs. A mock verifies the application's request handling, not actual provider compatibility; V03 establishes live compatibility.

**Outside scope:** login system, private tools, raw-audio proxying.

### V03 — One spoken conversation

**Dependencies:** V01, V02. **Provider calls:** required for the live acceptance check; use an explicitly authorized short budget.

**Deliverable:** Start/End controls, microphone input, WebRTC connection, and automatic spoken playback. Use one simple conversation prompt. The UI distinguishes connecting, ready, and ended. Set a short configurable safety timeout for the first live trial; full usage accounting comes later.

**Verify:** say a question and hear a relevant spoken answer, then speak a follow-up and hear its answer. End releases the microphone and connection. Capture device/browser, model, approximate duration, and the listening result without saving personal audio or credentials. Passing a mocked connection test does not complete this live check.

**Outside scope:** transcripts, storage, learning modes, detailed analytics.

### V04 — Failures and cleanup

**Dependencies:** V03. **Provider calls:** only for a bounded recovery check if needed.

**Deliverable:** clear microphone-denial, setup-failure, and disconnection states; repeated Start clicks cannot create duplicate sessions; End is safe while connecting and after failure. Stop microphone capture and playback immediately, cancel generation, and dispose owned resources. Any final-event drain has a bounded deadline; saving or waiting for transcripts cannot keep the microphone active.

**Verify:** permission denial, delayed/failed setup, network loss, and repeated start/end attempts. Check that the app never shows listening while disconnected and that a fresh attempt works after cleanup. Test delayed-success races with mocks; inspect microphone state on the real browser.

**Outside scope:** restoring previous conversation context; V18 owns that.

### V05 — Turn-taking and interruptions

**Dependencies:** V03, V04, V00. **Provider calls:** required for listening checks.

**Deliverable:** configurable semantic VAD policy, interruption support, and an explicit manual-turn mode that gates automatic response creation. Start with patient settings for explanations. Mark interrupted output as incomplete; do not assume word-aligned transcript truncation exists.

**Verify:** explain a concept with several pauses; interrupt an assistant reply; resume speaking; use the manual fallback. Automatic turns must not reply while manual mode is waiting, and each manual completion triggers one response. Record premature responses and whether playback stops. Exercise mode-switch/cancellation races with fixtures too. This step establishes behavior; V08 measures timing quantitatively.

**Outside scope:** claiming optimal VAD settings or published latency guarantees.

### V06 — Transcript normalization

**Dependencies:** V01. **Provider calls:** none for the core tests.

**Deliverable:** an application representation of finalized user/assistant turns, item identities, ordering, partial text, and interrupted/incomplete output. Define a small boundary between provider events and transcript state.

**Verify:** replay synthetic events with duplicates, late completions, interleaved speakers, partial-to-final updates, and interrupted assistant output. The result has correct ordering and no duplicated turns. When the heard portion is unknown, mark the whole assistant turn interrupted/uncertain and exclude it from claims about delivered teaching instead of guessing a text boundary. Confirm event shapes against current official documentation when implementing.

**Outside scope:** database and model evaluation. V21 connects the representation to live persistence.

### V07 — Offline usage cost calculation

**Dependencies:** V01. **Provider calls:** none.

**Deliverable:** a versioned rate configuration and deterministic calculation over usage records. Keep cached/uncached and audio/text categories separate; price transcription/review separately. Unknown models or incomplete categories produce an explicitly incomplete estimate, not zero cost. Define the input record contract for V23.

**Verify:** hand-calculated fixtures for fresh input, cached input, output, transcription, cancelled responses, and missing/unknown categories. Check that cached input and reported reasoning usage are not charged twice. Confirm a price-version change produces the expected estimate without rewriting historical records.

**Outside scope:** provider-event collection, budget enforcement, billing UI, subscriptions, actual monthly cost claims. V23 owns live wiring.

### V08 — Latency measurement

**Dependencies:** V03, V05. **Provider calls:** required for measurements.

**Deliverable:** timestamps for detected turn end, first audio-related events, playback start, and interruption stop, with a repeatable measurement procedure. Use one client monotonic clock for comparable event timings. Identify direct measurements and proxies: a playback callback is not proof of audible onset. Use manual annotation or authorized test audio for acoustic timings; VAD speech-stop is not an exact last-word timestamp.

**Verify:** measure a documented set of short exchanges and interruptions; record sample count, device/network, prompt version, VAD policy, and raw timings. Separate low/medium-eagerness profiles. Small samples are exploratory; before a p95 acceptance run, define its sample count and procedure, and report uncertainty. Compare actual audible measures with DESIGN.md targets; proxy measures must be labeled and cannot alone establish acceptance.

**Outside scope:** instrumentation services or a general observability platform.

### V09 — Teach-back

**Dependencies:** V00, V03, V05. **Provider calls:** required for behavior evaluation.

**Deliverable:** the first learning mode: listen to an explanation, identify a specific possible gap, and ask one focused follow-up instead of immediately lecturing. Add a mode/topic configuration boundary and initial session selector reused by later modes. Version the prompt and topic input. Mode selection applies at session start; mid-session mode switching is deferred.

**Verify:** use correct and deliberately incorrect explanations from V00. Record whether the assistant catches the misconception, avoids inventing a weakness, and leaves room for another attempt. Human-reviewed examples establish quality; a prompt snapshot test does not.

**Outside scope:** persistent mastery scores or learning memory.

### V10 — English-expression practice

**Dependencies:** V00, V03, V05, V09. **Provider calls:** required for behavior evaluation.

**Deliverable:** a mode that preserves the user's intended meaning, speaks a natural English version, invites repetition, and gives concise wording feedback. Handle Mandarin-English mixing.

**Verify:** use several synthetic intentions, including a technical phrase and an ambiguous request. Confirm the intended meaning is preserved and clarification is requested when needed. Repeat the English expression and assess the conversational feedback.

**Outside scope:** calibrated pronunciation scoring and retained recordings.

### V11 — Mock interview

**Dependencies:** V00, V03, V05, V09. **Provider calls:** required for behavior evaluation.

**Deliverable:** an interviewer mode that asks one question, allows an uninterrupted answer, and follows up on assumptions or trade-offs. Detailed tutoring is deferred unless requested.

**Verify:** complete a short mock interview with multiple follow-ups. Check that the assistant does not answer its own question or turn every answer into a lecture. Record a human assessment using V00's rubric.

**Outside scope:** question-bank integration or hiring predictions.

### V12 — Guided learning

**Dependencies:** V00, V03, V05, V09. **Provider calls:** required for behavior evaluation.

**Deliverable:** a tutor mode with short questions, examples, hints, and another attempt. Reuse the conversation transport rather than introducing another agent system.

**Verify:** the learner gives an incorrect answer, requests a hint, then tries again. Check that help adapts and the assistant can explain directly when requested rather than enforcing endless questions.

**Outside scope:** curriculum generation and course tracking.

### V13 — Session repository and no-save policy

**Dependencies:** V01, V06. **Provider calls:** none for this step's verification.

**Deliverable:** SQLite session/turn records and a small repository interface. Use application conversation identities distinct from provider session/item IDs, allowing multiple provider sessions under one conversation. Support idempotent writes, transcript revisions, incomplete-session markers, and a no-save policy. Choose storage paths ignored by Git. Saving off excludes new durable conversation content; automatic recent archived context still loads under the updated user requirement; content-free usage metadata follows DESIGN.md. Usage integration follows V07/V23 separately; basic transcript storage does not require a model-quality decision or evaluator.

**Verify:** insert synthetic records, restart/reopen the database, replay duplicate/reordered writes, and retry a failed transaction. Confirm correct revisions, isolation between sessions, and no durable conversation content for a no-save session. Schema initialization/migration must preserve existing records. No provider connection or UI is needed.

**Outside scope:** live event wiring, transcript UI, raw audio, sync, review generation. V21 and V22 own integration and display.

### V25 — Background continuity summaries

**Dependencies:** V13 and the implemented V21 writer/finalization path. V21's spoken-capture acceptance remains pending; fixture-based work is authorized independently. **Provider calls:** a bounded synthetic schema/evidence check.

**Deliverable:** a short title in the conversation’s main language plus compact topics, explicitly stated facts, decisions and unresolved questions, tied to a source revision and turn references. Produce title and points in the same structured response; ended legacy conversations without titles are queued automatically in bounded batches. Never reset exhausted current-revision jobs on every poll. Durable jobs run after final capture writes, with one background worker loop, bounded provider input/output/time/retries, lease recovery, and stale-result rejection. Existing untitled archived sessions are prepared automatically; new saved sessions schedule automatically after End. Keep uncertain capture warnings, exclude interrupted/unfinished/unordered turns, and disclose limited coverage. A summary is optional continuity data, not a learning assessment.

**Verify:** real SQLite restart/claim/revision/deletion/expiry tests, provider refusal/incomplete/invalid-reference fixtures, long mixed-language bounds, and a synthetic live provider request. A blocked summary request must not block a fresh voice credential request. No-save creates no summary job. Remaining summary accuracy on real long conversations is a listening/review follow-up, not established by schema validation.

**Outside scope:** learning strengths/gaps, traits, scoring, automatic learning-note promotion, topic search, or bulk generation for the old archive.

### V26 — Automatic bounded recent-history context

**Dependencies:** V13, the implemented V22 viewer, V25. **Provider calls:** none required at Start; background summary work remains separate.

**Deliverable:** automatically choose the three most recent eligible ended sessions. Reuse current ready summaries and bounded finalized excerpts; use excerpts while summaries are pending/failed. Assemble only those sources under a 6,000-byte UTF-8 cap with per-source contribution, omission notices, revision validation and single-use reservations. Remove the manual selection/preview UI. Saving off stops new writes while still loading prior context.

**Verify:** recent-three selection, active/empty/expired/deleted exclusion, mixed-language bounds and source contribution, pending-summary fallback without provider waiting, stale/deleted-source rejection, and no new archive writes with saving off. Check the browser has no history checkbox/preview step. Spoken WebRTC recall remains a separate pending acceptance check.

**Outside scope:** semantic search, embeddings, exhaustive whole-archive recall, learning-note inference, editing generated insights, or indefinitely retained summaries.

### V27 — Startup context loading

**Dependencies:** V25, V26 and the implemented V03/V04 WebRTC lifecycle. The pending spoken acceptance remains explicit. **Provider calls:** one bounded synthetic Realtime text-history/recall check, then a short user listening check.

**Deliverable:** consume and revalidate the server-issued preview, load the exact prepared context as a quoted user text item, and hold microphone tracks muted until the matching item-finalization acknowledgment. Never trigger a response just by loading history. Ignore the injected context item in the new transcript archive, normalizing its first live successor to the archive root. Prevent deletion of a source while a setup reservation or active voice session uses it. Sessions with saving off still load history but create no transcript observer or content writes. Failure closes media and requires a new Start rather than silently dropping history.

**Verify:** acknowledgment gating, one injection, wrong/delayed/missing acknowledgment, setup timeout/cleanup, source deletion/reservations, transcript isolation, and a synthetic provider recall check. Finish with a short saved WebRTC conversation: choose a prior fact, ask about it, End immediately after final words, inspect final capture, then confirm saving-off sessions recall history without creating a new archive record.

**Outside scope:** automatic continuation after disconnection/45-minute expiry (V18), guaranteed cache hits, or learning-memory inference (V15).

### V14 — Post-session review

**Dependencies:** V00, V13, V21. **Provider calls:** required for evaluator-quality validation, not for schema/retry tests.

**Deliverable:** a review over an identified transcript revision: summary, strengths, possible gaps, useful expressions, practice suggestions, and source-turn references. Persist pending/complete/failed state and recover pending jobs after restart. Treat transcript text as data, not evaluator instructions. Retry without duplicates; reject results for deleted sessions or superseded revisions. No-save sessions create no review jobs.

**Verify:** validate output structure/reference existence with fixtures; test timeout, restart, retry, and late transcript updates. Human-review correct, incorrect, and uncertain transcripts with the actual evaluator. Exclude interrupted assistant text when its heard boundary is unknown. A stale job cannot overwrite newer review evidence or recreate a deleted session. Live voice remains responsive during review.

**Outside scope:** automatic permanent learning-note promotion; V15 owns that policy. V25 continuity summaries are independently usable and do not require this broader review.

### V15 — Learning memory

**Dependencies:** V13, V14, V22, V24 (learning-quality gate). **Provider calls:** none for selection logic; one next-session behavior check.

**Deliverable:** inspectable learning notes with provenance, tentative/resolved status, and correction/removal controls. Start with user-confirmed promotion of proposed notes. Select a bounded set by explicit topic tags or SQLite search and supply it at a new session's start.

**Verify:** two topics retrieve correct notes without unrelated history; corrections supersede prior interpretations. In a new session, revisit a supported gap and confirm that uncertainty is preserved. No-save sessions neither load prior learning notes nor write conversation content or create review jobs.

**Outside scope:** embeddings, a knowledge graph, or scientifically calibrated mastery.

### V16 — Retention and deletion

**Dependencies:** V13, V14, V15. **Provider calls:** none.

**Deliverable:** enforce DESIGN.md's separate policies for automatic transcript expiry and explicit session-and-learning deletion. Remove expired transcript text and detailed excerpts while marking retained compact notes' sources unavailable. Explicit deletion removes dependent notes or recomputes them from remaining independent evidence. Invalidate jobs and buffered retries; close a running session containing deleted context. Explain provider retention separately.

**Verify:** use a controllable clock and linked synthetic records to test expiry, pinning, explicit deletion, and multi-session note provenance. Delete while a review or save retry is pending; its eventual completion must not recreate content. Confirm retained notes do not contain copied expired transcript excerpts. Restart/reopen and confirm deleted data is not retrieved and unrelated records remain intact.

**Outside scope:** promising deletion from provider abuse-monitoring systems or zero provider retention.

### V17 — Context limits and cache visibility

**Dependencies:** V13, V15, V23. **Provider calls:** required to observe real caching, not for selection/truncation logic.

**Deliverable:** configurable live-context limits, stable prompt ordering, and cache-usage reporting. Generate a compact summary from eligible finalized turns at explicit boundaries before intentional context replacement. If context was already lost, mark the gap. Begin with DESIGN.md's proposed token-window experiments; verify supported configuration against current documentation.

**Verify:** fixtures show bounded context and summary-before-replacement ordering, including summary failure and unexpected automatic truncation. In authorized live sessions, record cached-token behavior before/after a boundary and check recall. Test no-save handling without persistent summaries. A cache miss is an observation, not automatically a defect; the app must work without hits.

**Outside scope:** Redis, guaranteed cache lifetimes, or rewriting a summary on every turn.

### V18 — Continuation after replacement connection

**Dependencies:** V04, V13, V17, V21. **Provider calls:** required for a bounded reconnection check.

**Deliverable:** create a new session with selected summary and recent finalized turns after connection loss or planned rollover. Preserve application identity while changing provider identity; insert restored turns as supported text context, not invented audio history. With saving off, continuation can use surviving in-memory state and automatic recent archived context; unsaved speech is unavailable after its live context is lost.

**Verify:** force a replacement connection with a short test timeout rather than paying for an hour of waiting. Confirm the new session retains a chosen fact, does not duplicate transcript turns, and releases the old microphone/connection. Confirm rollover timing against the provider limit when implementing. Check that saving-off continuation does not claim to recover unsaved speech after a browser restart; only retained archive context can be restored then.

**Outside scope:** seamless offline conversation or reconstructing lost unsaved speech.

### V19 — Long-session and MVP validation

**Dependencies:** V00, V05, V08, V09, V10, V11, V12, V16, V17, V18, V23, V24. **Provider calls:** required within a finite established experiment budget.

**Deliverable:** a reproducible regression report for the candidate default selected in V24, with full/Mini comparisons where useful. Include 5-, 15-, and 45-minute sessions as budget allows. Before running, define supported profiles, acceptable rubric outcomes, latency sample procedure, and a user-approved cost target. Separate exploratory results from adequately sampled measurements.

**Verify:** report measured usage/cost categories, latency, interruptions, bilingual failures, misconception detection, recall, and deletion/no-save regressions. Record missing required runs as pending; budget exhaustion is not a pass. Confirm or revise the default based on the predeclared criteria. Reconsider architecture if the use case remains unmet.

**Outside scope:** declaring a universal best model or a guaranteed monthly bill.

### V20 — Phone and Bluetooth evaluation

**Dependencies:** V03, V04, V05, V23; V18 only for continuity acceptance. **Provider calls:** required for listening checks. Foreground/routing/lock feasibility can be evaluated early without V18; record continuity as pending until its dependency is ready.

**Deliverable:** a documented supported-device matrix for foreground phone use, audio routing, screen locking, interruptions, and reconnection. Use a trusted HTTPS development origin for phone microphone access and protect the credential endpoint; a phone cannot use the laptop's loopback-only server without an explicit access setup.

**Verify:** try the user's actual phone and earbuds. Record what works, what fails, and whether a native client is necessary for the desired locked-screen experience. A documented browser limitation is a valid experiment result, not a passing hands-free capability.

**Outside scope:** glasses integration, a native app, or public deployment.

### V21 — Live transcript persistence

**Dependencies:** V03, V04, V06, V13. **Provider calls:** required for a short transcription and failure-isolation check within an authorized budget.

**Deliverable:** enable input transcription for saved sessions and capture finalized transcript events through a backend sideband to the same Realtime session, leaving primary audio on browser WebRTC. Bind the call ID to a server-issued application conversation and verify ownership before attachment. Use one durable writer with a bounded asynchronous queue, revision-aware idempotent writes, retry backoff, and independent saving/delayed/incomplete status. Saving or capture failure must not gate replies or close healthy audio. No-save bypasses durable content writes. Release media immediately on End; use a bounded transcript drain and save already-received turns independently. Late events remain bound to their original session and invalidate stale reviews when those exist.

**Verify:** first replay fixtures with slow/locked/unavailable storage, duplicates, reordering, sideband loss/reattachment, queue exhaustion, stale revisions, deletion, and End during a pending write. Confirm bounded memory, no duplicate turns, no writes in no-save mode, and no voice teardown caused by save failures. Then save a bounded bilingual exchange, interrupt output, force a save failure, and end before transcription completes. Verify call ownership, attachment timing/gaps, and compare response timing with saving enabled/disabled; record proxies and listening observations separately. Mark uncertain heard boundaries and missing events explicitly. A process crash may lose uncommitted queued content. Roll out on a fresh session without refreshing/restarting an active user conversation; no retroactive capture is promised.

**Outside scope:** session browsing UI, evaluator, summary generation, context injection, raw audio recording, guaranteed lossless capture, or a separate queue service. Async tasks do not imply separate AI conversations or mandatory OS threads.

### V22 — Saved-session display

**Dependencies:** V13. **Provider calls:** none.

**Deliverable:** a compact list/detail view over saved synthetic or real records, with a concise current-summary paragraph above transcript text. Remove the generic Transcript details diagnostic block; keep interrupted/missing text identifiable in individual turns and retain source-expiry/deletion behavior. Provide the UI foundation for later learning-note controls.

**Verify:** inspect fixtures for a complete, incomplete, interrupted, expired, and empty session. User/assistant speakers and pending/unsaved states are distinguishable, and uncertain text is not presented as confirmed delivered speech. Confirm no-save content cannot be reopened.

**Outside scope:** live event transport, review generation, full editing, or analytics dashboards.

### V28 — Conversation categories

**Dependencies:** V13 and the implemented V22 viewer. **Provider calls:** none.

**Deliverable:** user-named categories, one category per conversation, Uncategorized fallback and grouped history. Use compact heading menus and a small + Category creation popover instead of a full management form. Support create/rename/remove and per-conversation reassignment. Removing a category keeps its conversations. Category metadata must not modify transcript revision, summary evidence, or active voice behavior. Limit names to 60 characters and category count to 50; reject duplicates and invalid IDs.

**Verify:** real SQLite v3-to-v4 migration/reopen, content/summary preservation, assignment/rename/remove, duplicate/blank/invalid-name validation, grouping each record exactly once, deleted-session protection, and browser creation/assignment/removal using disposable synthetic data. Confirm no model calls are needed and personal records remain unchanged.

**Outside scope:** inferred categories, bulk automatic classification, nested folders, multiple tags, or changing model context based on category alone.

### V23 — Live usage and session budgets

**Dependencies:** V03, V04, V07. **Provider calls:** a short bounded wiring check.

**Deliverable:** adapt provider usage events to V07's calculation contract, deduplicate response identities, and expose an estimated session total. Add configurable duration/estimated-spend limits. Use transient collection before storage integration; never log message content with usage.

**Verify:** replay repeated, cancelled, partial, and unknown-model usage events. Test the duration limit and estimated-spend overshoot with a fake clock/events; stopping must release resources. In a short live session, match recorded categories to received provider events. Unknown usage is visibly incomplete and cannot disable the independent duration limit. Do not claim invoice reconciliation or an exact spending cutoff.

**Outside scope:** SQLite wiring, invoice APIs, subscriptions, and a hard provider-side spending guarantee.

### V24 — Early voice-model comparison

**Dependencies:** V00, V05, V08, V09, V10, V23. **Provider calls:** required within an established short experiment budget.

**Deliverable:** compare full and Mini on teach-back and English-expression scenarios before automatic learning-memory work. Basic transcript archival can precede this experiment. Freeze prompts, VAD profiles, scenario order/repetitions, and critical-failure criteria before the experiment. Record exploratory timing/cost and choose a provisional model or document that neither is acceptable.

**Verify:** human-reviewed results cover correct and incorrect technical explanations, mixed languages, pauses, and interruptions. Investigate critical failures before selecting a default; do not hide them behind an average score. If neither meets the rubric, record a design revision rather than proceeding with a false pass. This can complete as an experiment with a negative result; subsequent learning-memory work should wait for a sound voice foundation.

**Outside scope:** long-session statistics, all-mode acceptance, storage, and guaranteed quality claims.

## Dependency order and decision gates

One valid order is V00 → V01 → V02 → V03 → V04 → V05 → V06 → V13 → V21 → V22 → V07 → V23 → V08 → V09 → V10 → V24 → V11 → V12 → V14 → V15 → V16 → V17 → V18 → V19 → V20. Independent fixture work may be reordered when dependencies remain satisfied.

The next proposed archive increment is V06 → V13 → V21 → V22 after their voice dependencies are ready; it saves turns without adding teaching evaluation or changing the current voice behavior. Saving alone does not make a replacement model session remember them: V17/V18 own bounded context and continuation, and V15 owns automatic learning memory. Before V15, review V24's result and resolve critical voice-quality failures. This is a product decision gate, not a requirement to repeat permission requests for already-authorized work. Before accepting the full MVP, V19 must cover all four modes and the data lifecycle. If phone use is required, V20 is also part of acceptance.

## Suggested checkpoints

- **First audible value:** V03. A real spoken exchange exists before storage or learning infrastructure.
- **Saved conversation archive:** V06, V13, V21, and V22. Turns save in the background while speech continues; this does not yet establish cross-session recall.
- **Useful personal prototype:** V04, V05, V07, V23, V08, V09, V10, and V24. Teach-back and English expression have a provisional model, visible usage, and measured timing.
- **Learning across sessions:** V13, V21, V22, V14–V18, with their dependencies satisfied and the early quality gate resolved.
- **MVP decision:** V19, plus V20 if phone use is required. Decide whether to expand based on observed evidence.

V06, V07, V13, and V22 have offline verification paths. V10–V12 do not depend on each other. These boundaries allow focused work without asserting that shared-file work is safe to run concurrently.

## Decision log

- **2026-10-16:** Keep the plan and evidence in one repository file initially. A separate tracker or workflow service is unnecessary at this project size.
- **2026-10-16:** Use independently verifiable increments with explicit dependencies. Prioritize an audible voice exchange before persistence and memory.
- **2026-10-16:** Preserve the planning-only boundary. A listed step is not authorization to implement or incur API charges.
- **2026-10-16, documentation review:** Split usage calculation from live collection/budgets (V07/V23), and split storage from live wiring and display (V13/V21/V22). Preserve existing IDs and add V24 for early model comparison. The original plan had 21 steps; the revised plan has 25.
- **2026-10-16, documentation review:** Use conservative interruption markers because exact heard-word transcript alignment is unavailable. Define bounded shutdown, transcript revisions, job invalidation, explicit no-save semantics, and separate automatic expiry from full deletion.
- **2026-10-16, implementation:** Use direct browser WebRTC and native fetch for the first voice slice; the design allowed a lower-level transport when useful. No agent framework, storage, or evaluation service was added. The user authorized starting implementation and requested notification when a key is needed.
- **2026-10-16, user preferences:** Use frontend port 4317 and backend port 4318, never 5173. Keep human documents in `docs/` and root `AGENTS.md` for Codex discovery. Use Vox's editorial wordmark as a visual reference; the current UI bundles Bodoni Moda for branding/headlines and Inter for controls/body text locally.
- **2026-10-16, persistence design update:** prefer backend sideband capture plus bounded background SQLite writes for long/walking conversations. Voice and saving are separate async tasks observing one conversation, not separate AI conversations. Move the quality gate from basic archival to V15 learning memory; remove usage accounting as a prerequisite for transcript saving. Protect active conversations during rollout. This updates planned scope only.

These are scope and implementation decisions, not model-quality or latency results.

## Evidence log

The original design commit is `d6a6e6c`; it establishes documentation only. Current implementation evidence is recorded below. The historical documentation review predates implementation and uses the files' former root locations.

### 2026-10-16 America/Los_Angeles — Documentation review

- **Scope:** reviewed all four repository documents: `README.md`, `AGENTS.md`, `DESIGN.md`, and `PLANS.md`. No application code, provider sessions, or paid experiments were run.
- **Source verification:** reopened official documentation for Realtime/WebRTC architecture, VAD, session duration, input transcription, interruption behavior, cost accounting, model capabilities, and provider data controls. Published audio prices and the arithmetic baselines remain consistent with the design. The API reference confirms configurable conversation limits/retention ratios. Older 32k examples in the caching cookbook are examples, not the current model's context limit.
- **Corrected:** exact heard-word transcript assumptions; shutdown ordering; asynchronous finalization and stale review handling; no-save reads/writes; automatic expiry versus explicit deletion; deletion during pending work or active context; missing shared-mode dependencies; the late model-quality decision; oversized usage and persistence steps. Stable existing step IDs were preserved.
- **Mechanical checks actually run:** `git diff --check` passed. A `python3` inline audit checked all Markdown files for local-link targets, balanced code fences, and trailing whitespace; verified 25 unique pending steps and required acceptance fields; built the dependency graph, checked it for cycles, and verified the stated execution order. All passed. Decimal arithmetic independently reproduced $0.90/$2.88 per fresh-audio hour and $13.50/$43.20 for the stated monthly scenario, plus the separate $45 GPT-Live duration example.
- **Result:** no remaining known contradiction blocks starting the documentation/scaffold steps. All implementation entries remain not started. The review establishes planning consistency and documented API support, not product feasibility or performance.
- **Still unverified:** account/model access, actual speech quality, bilingual understanding, latency targets, complete session cost, cache behavior, mobile background audio, and real interruption/reconnection behavior. These have explicit experiments in the plan. Select live budgets before experiments and settle retention/storage defaults before the corresponding persistence step.

When work starts, append concise entries using this template:

```text
Date and timezone:
Step ID and status:
Scope / material decision:
Checks actually run and results:
Live / human checks and who observed them:
Skipped checks and limitations:
Changed files / commit when available:
Next step or blocker:
```

Do not paste secrets, personal transcripts, or large logs into this file. Link to sanitized artifacts if needed. Correct inaccurate earlier evidence with an explicit correction rather than silently changing its meaning.

### 2026-10-16 America/Los_Angeles — First local implementation

- **Authorization:** the user requested implementation and notification when an API key is needed. Subsequent requests changed ports, typography, and documentation layout; the initial voice objective remains in scope.
- **V00 complete:** `docs/conversation-scenarios.md` defines synthetic correct/incorrect technical explanations, bilingual expression, pauses, interruptions, and mode expectations, with critical failures and an observation template. No model results are claimed.
- **V01 complete:** added pinned npm dependencies/lockfile, local React/Vite and Fastify projects, strict TypeScript configuration, a health endpoint, and documented dev/build/check commands. Fonts are served locally. The frontend was inspected in the in-app browser on port 4317; the API was checked on port 4318.
- **V02 complete (mocked acceptance):** session credentials are created only on the backend; tests cover missing configuration, sanitized provider rejection/network failure, invalid/expired responses, provider timeout, local origin/host restrictions, and fixed server-selected session defaults. The response exposes only the temporary credential, expiry, and trial timeout. Live provider compatibility belongs to V03 and remains unverified.
- **V03 in progress:** implemented microphone input, temporary-key SDP exchange, spoken playback, Start/End/Mute, connected state, and a two-minute default trial timeout. Offline transport tests pass. A real question/reply/follow-up listening check is pending an API key and an established live budget.
- **V04 in progress:** implemented cleanup, cancellation, permission-denial/disconnection states, duplicate-start prevention, late-permission/credential guards, and retry. Mocked media tests cover these races and timeout disposal. Real browser microphone indicators and recovery need a live/manual check; this is not marked complete.
- **Checks observed:** `npm run check` passed: TypeScript, 32 offline tests in two files, and client/server production builds. `git check-ignore .env` confirmed key-file exclusion. `npm ls react react-dom` showed one deduplicated React version. Inline Node requests through frontend port 4317 verified the health proxy (`realtimeConfigured: false`, full reference model, 120-second trial) and the session endpoint's `503 API_KEY_REQUIRED` response. `lsof` confirmed both processes listen only on loopback ports 4317/4318. A five-document link/status/dependency audit and `git diff --check` passed after the move.
- **Corrections during verification:** the first font-package subpath was unavailable; importing its documented package entry fixed the build. Dependency changes during a running Vite session caused a transient duplicate-React module error; restarting and explicitly prebundling React imports restored the page. Final builds passed after the typography changes.
- **Key handling:** an ignored local `.env` with a blank `OPENAI_API_KEY` was prepared. No permanent key was read or printed, and no live OpenAI request or microphone capture was performed.
- **Next:** configure the server key locally, restart the dev process, then complete V03's bounded listening check. V05 tuning and later learning functionality remain not started. Changes are uncommitted.

### 2026-10-16 America/Los_Angeles — API-key setup verified

- The user configured the ignored local `.env` and the dev process was restarted. Health reported a configured key, the full reference model, and the existing 120-second trial limit.
- One call through local `POST /api/session` returned HTTP 200 and a temporary OpenAI credential. Only the response status and a boolean credential-validity check were printed; neither permanent nor temporary credentials were logged.
- The browser shows “Ready to talk” with Start enabled on port 4317. No microphone audio was captured and no speech response was generated during this check.
- V03/V04 remain in progress until a real spoken question, reply, follow-up, and microphone cleanup are observed. The user can run the existing two-minute trial from the interface; no additional paid audio experiment was started by the agent.

### 2026-10-16 America/Los_Angeles — Thinking-pause adjustment

- **User observation:** the companion began replying during thinking pauses. This confirms a user-observed spoken response, but does not establish V03/V04's complete acceptance checks, timings, or microphone cleanup.
- **V05 in progress, partial scope:** changed the basic conversation's semantic VAD eagerness from `medium` to `low`, keeping automatic replies and speech interruption enabled. This is a patient default, not a guaranteed silence duration. Existing sessions retain their settings; start a new session to try the change.
- **Source:** [official OpenAI VAD documentation](https://developers.openai.com/api/docs/guides/realtime-vad) recommends low eagerness to give users more time. Semantic completion can still trigger a response before a long pause ends.
- **Checks observed:** `npm run check` passed (TypeScript, 32 offline tests, client/server production builds). The mocked session request verifies low eagerness with automatic replies and speech interruption still enabled. `git diff --check` passed; local health on port 4317 returned HTTP 200 with the backend configured.
- **Live verification pending:** repeat C01 with real thinking pauses in a new session. No paid provider request or microphone capture was made for this change. Configurable profiles, manual completion, and their race tests remain outstanding; V05 is not complete.

### 2026-10-16 America/Los_Angeles — MVP commit checkpoint

- **Authorization:** the user accepted the current MVP and requested a commit. This checkpoint includes the local audio-in/audio-out app, server-owned temporary credentials, Start/End/Mute and resource cleanup, the two-minute trial limit, patient semantic VAD, bundled typography, ports 4317/4318, and repository documentation.
- **Checks observed:** `npm run check` passed (TypeScript, 32 offline tests, client/server production builds). No additional live provider request or microphone capture was performed for this checkpoint.
- **Acceptance boundary:** user acceptance is recorded without claiming the broader planned MVP or detailed V03–V05 listening/recovery criteria are complete. Tools, explicit reasoning-effort configuration, learning modes, persistence, and manual turn completion remain unimplemented.
- **Next:** retain this working checkpoint; continue only with the next user-authorized scope.

### 2026-10-16 America/Los_Angeles — Longer session limit

- **Authorization / scope:** the user requested increasing the session limit first. Raised the default and local setting from 120 to 2700 seconds (45 minutes), with matching server and browser validation permitting 30–2700 seconds. Updated the environment template, README, and on-screen wording. No persistence, audible alerts, or automatic continuation was added.
- **Checks observed:** `npm run check` passed (TypeScript, 37 offline tests, client/server production builds). Fake-clock regression checks show a 45-minute session stays connected past two minutes and releases media at expiry. Server and browser tests cover accepted/rejected duration boundaries. `git diff --check` passed.
- **Runtime:** restarted the managed local dev process on ports 4317/4318. Frontend-proxied health returned HTTP 200, `sessionMaxSeconds: 2700`, and a configured backend. The ignored `.env` duration was updated without displaying the API key. Refresh the page and start a new session to use the new limit.
- **Limits:** timer behavior is verified with mocks, not a 45-minute listening run. No live provider request or microphone capture was made. V23 usage/spend accounting and V18 continuation remain pending; this change does not complete either step. Changes are uncommitted.

### 2026-10-16 America/Los_Angeles — Background persistence documentation

- **Authorization / scope:** the user requested documentation updates only. Updated DESIGN.md and PLANS.md to separate direct WebRTC voice, backend transcript capture, background saving, and later context restoration. Persistence remains unimplemented. Existing uncommitted duration changes were preserved.
- **Source verification:** reopened the official Realtime server-side controls documentation. It describes attaching a backend to the same WebRTC call using the SDP response's call ID; it does not establish lossless capture or recovery of previously uncollected speech.
- **Plan changes:** V13 basic archival no longer depends on usage accounting or V24. V21 specifies backend capture, one writer, bounded retries/queues, and failure isolation. V24 remains the quality gate for V15 learning memory. Added fresh-session rollout and explicit save-versus-recall boundaries.
- **Verification:** an inline Python audit passed across five Markdown files: local links and code fences are valid; all 25 step IDs match the checklist, include acceptance fields, and follow the stated dependency order. `git diff --check` passed. No application code, live connection, microphone, or dev process was changed during this documentation update. No application tests or paid provider calls were run.

### 2026-10-16 America/Los_Angeles — Background transcript persistence implementation

- **Authorization / rollout:** the user requested implementation, confirmed no conversation was running and authorized activation when ready, then clarified that final turns must save after End. Development and initial verification ran in an isolated temporary copy. Activated the app on ports 4317/4318, preserving the ignored key and 45-minute setting. Subsequent shutdown fixes were applied after the browser showed no active voice session.
- **V06 complete (offline):** normalized item-linked ordering, asynchronous input transcription, multipart final text, revisions/deduplication, detected-but-unfinished input, failed transcription, and conservative interrupted output. Raw audio/delta payloads are not stored. The normalizer and queue have bounded content/item limits.
- **V13 complete (offline):** added SQLite storage in a dedicated Node worker, schema initialization, idempotent revision writes, reopen persistence, conversation isolation, delete tombstones that reject late writes, and transcript expiry on history access. No-save bypasses capture and durable content writes. Node 22.13+ is now required for the unflagged built-in SQLite API; its experimental warning is expected on the installed runtime.
- **V21 in progress:** saved sessions enable input transcription, use a server-owned SDP handshake and one-use setup handle, and attach a backend sideband to the provider-returned call ID. One bounded background queue owns writes; failures and retry status are independent of voice. End immediately stops tracks/playback, shows finalizing, allows a 12-second observer drain and a 15-second client transport deadline, and keeps saving received turns afterward. No summaries or model-context restoration were added.
- **V22 in progress:** implemented save/no-save selection, independent save status, a refreshable conversation list/detail view, interruption/order/incomplete labels, and deletion after finalization. Browser inspection covered the empty list and a synthetic bilingual transcript with interrupted output. Only the synthetic fixture was removed afterward; other archive entries were preserved. Broader viewer/live acceptance remains pending.
- **Checks observed:** `npm run check` passed after the final shutdown fixes: TypeScript, 59 offline tests across six files, and client/server production builds. Tests include a real SQLite lock/recovery check, worker reopen, stale revisions/deletion, queue overflow/retry bounds, sideband ownership/failure/reconnect fixtures, late transcription five seconds after End, immediate microphone/playback stop with delayed transport closure, and isolation from a newly started session. A standalone worker smoke check exposed inherited CLI flags; clearing worker `execArgv` fixed it, and the final checks passed. Dependency installation audited zero vulnerabilities.
- **Runtime / provider:** local health returned HTTP 200 with a configured backend and 2700-second limit; the conversation API responded successfully. One saved-session credential-only request returned HTTP 200 and a valid opaque handle, validating provider acceptance of the input-transcription configuration. No permanent/temporary credentials were printed; the empty verification archive entry was removed. This check did not establish WebRTC sideband delivery, audible output, or ASR accuracy. The five-document link/fence audit, 25-step dependency/order audit, versionable-file credential-pattern scan, and `git diff --check` passed; `.env` and the runtime database remain ignored.
- **Limits / next check:** no microphone capture or speech generation was performed by the agent. Run the README's short saved/no-save listening check, especially End immediately after the final words, late ASR delivery, interruption labels, and saving failures. V21 and V22 remain unchecked until their remaining acceptance checks are observed. Capturing earlier unsaved speech, restoring history to a new model session, automatic continuation, learning notes, usage/spend accounting, and pinning remain unimplemented. All implementation changes are uncommitted.

### 2026-10-16 America/Los_Angeles — Capture warning diagnosis and correction

- **Report / evidence:** the user reported all three archived conversations labeled incomplete. A read-only metadata audit found 14 saved turns: newest six (one unfinished input and one unknown ordering link), middle eight (all finalized with known links), oldest zero. The archive stored only a sticky Boolean, so the original cause of each historical flag cannot be reconstructed. No historical warning was cleared and no transcript content was edited.
- **Confirmed defect:** the capture observer treated every provider error as transcript loss, including harmless idle `response.cancel`. A bounded live WebSocket probe with no audio or response generation returned `response_cancel_not_active` and `input_audio_buffer_commit_empty`, correlated to our probe request IDs. Official Realtime documentation confirms idle cancellation is safe and empty input commit returns an error. These observations demonstrate a false-positive path; they do not prove which event caused each historical flag.
- **Correction:** tag End cleanup requests; share a narrow expected-error classifier across client and observer; ignore idle cancellation and only our tagged final empty-buffer commit. Unexpected errors still fail visibly. Preserve ordering from `input_audio_buffer.committed` and `conversation.item.done`, and do not erase a known predecessor when later item metadata omits it. Unresolved detected input still remains incomplete; a manual commit can change a provisional speech item ID, and historical records cannot establish whether that happened here. Automatic merging or deletion of these uncertain placeholders is not implemented.
- **Diagnostics / archive:** schema v2 adds sanitized application reason codes without rewriting turns. List/detail include saved-turn counts; known warnings explain observer loss, provider errors, missing final text, or ordering gaps. Existing flags without recorded causes display **Completeness unverified**, with an explanation in detail. This wording change does not certify old transcripts as complete. The raw events/provider error messages remain unrecorded.
- **Verification:** `npm run check` passed in the isolated copy and the activated repository: TypeScript, 67 offline tests, and client/server production builds. New regressions cover expected/unexpected errors, final-text/order warnings, preserved commit ordering, and a real schema-v1 archive migration. The first run exposed an outdated exact-payload assertion; it was updated to verify the tagged End commit, then the complete checks passed. After activation, the local history API returned counts 6/8/0, schema version 2, and a checksum comparison confirmed all 14 stored turn payloads were unchanged. Browser inspection confirmed these counts and the legacy warning wording.
- **Rollout / limits:** activated only after the browser showed Ready to talk. Services remain on 4317/4318. No speech recording, generated response, or listening check was performed by the agent. Run a fresh short saved conversation and End check to verify the real browser/sideband path; V21/V22 remain in progress. Existing missing final text cannot be recovered from the archive. Changes remain uncommitted.

### 2026-10-16 America/Los_Angeles — Compact transcript presentation

- **Scope:** the user requested smaller transcript type and less space between turns. Adjusted only saved-conversation markup/styles: 13px text with 1.5 line height (previously 14px/1.7), 8px vertical turn padding (previously 16px), a 3px speaker-to-text gap (previously 8px), smaller wrapped speaker/status labels, and compact metadata/warning typography. Shortened the unknown-capture warning while preserving its uncertainty. Archive and voice behavior are unchanged.
- **Verification:** `npm run check` passed: TypeScript, 67 existing offline tests, and client/server production builds. No new tests were added for this presentation-only change. Browser inspection of the existing six-turn transcript verified computed 13px/19.5px text, 8px row padding, 11px notice text, and no horizontal panel overflow at the current narrow viewport. The screenshot shows all six turns and the deletion control in the compact panel. `git diff --check` passed.
- **Rollout / limits:** applied while the browser showed Ready to talk; Vite hot reload activated the presentation. No services were restarted, no microphone/provider calls were made, and stored turns were not modified. Broader V22 acceptance remains in progress. The subsequent optional-history request is design discussion; no context restoration or summary generation was implemented. Changes remain uncommitted.

### 2026-10-16 America/Los_Angeles — Optional selected-session continuity

- **Authorization / scope:** the user requested autonomous implementation while taking a break. Split continuity into V25 background summaries, V26 selection/preview, and V27 startup loading, separate from V14 learning reviews, V15 inferred learning memory, and V18 automatic rollover. Development and initial checks ran in an isolated temporary copy; activated only after the browser showed Ready to talk.
- **V25 complete for its bounded scope:** schema v3 adds durable summary jobs with revision, claim token, attempts, lease, status and value. End schedules only after final queued writes. One asynchronous runner processes pending work, with a 90-second job deadline, 30-second request deadlines, at most three automatic attempts, and stale/deleted/expired-result rejection. Reuse ready revisions; old archives require explicit preparation. Split input into bounded sections, summarize at most the latest six, merge compact points, validate cited turn IDs, and disclose missing/omitted/uncertain input. The full retained transcript is not shortened. Default summary model is `gpt-5.6-terra`, Responses API with `store: false`; new saved sessions incur additional summary usage. No-save creates no summary or recall input.
- **V26 implemented / acceptance in progress:** opt-in picker for up to three ended sessions, readable preview, summary retry/preparation status, and a bounded 6,000-byte UTF-8 context packet. Round-robin selection preserves contributions from each selected session or rejects an unusable selection. Single-use previews expire in five minutes, bind source revisions, and invalidate on selection changes/deletion. Start is gated on a prepared selection. Browser checks verified selection, readable synthetic facts/excerpts, Start gating, empty history after fixture deletion, the no-save exclusion, restored fresh defaults, and no horizontal panel overflow at the current narrow viewport. Broader multi-selection and timed UI-expiry interaction checks remain pending; server selection/expiry/isolation fixtures pass.
- **V27 implemented / spoken acceptance pending:** new selected-context sessions keep microphone tracks disabled until the exact injected text item's `conversation.item.done`. Never request a model response during bootstrap. Invalid, rejected, missing or timed-out context stops setup and releases media. Context is excluded from new transcript storage, including its predecessor link; source deletion is blocked during setup/active use. Fresh sessions keep their original startup path. No automatic connection rollover was added.
- **Offline verification:** final `npm run check` passed with TypeScript, 82 tests across seven files, and client/server production builds. New tests cover SQLite job/restart/claim/revision/delete/expiry, bounded retries and explicit retry, refused/incomplete/invalid-reference outputs, long bilingual input, selected-source isolation and size limits, stale/expired/reused previews, no-save, source-use deletion, a blocked summarizer alongside a successful fresh voice setup, context acknowledgment/timeout/cleanup, and injected-context archive isolation. An integrated fixture verified final ASR five seconds after End is committed before a summary is generated. Final code review also fixed cleanup of a registered capture when selected-context validation fails.
- **Live provider verification:** two bounded synthetic trials were run. The provisional `gpt-5-mini` returned four points with valid references, but final documentation review flagged it as deprecated. Switched the default to `gpt-5.6-terra` with reasoning disabled; that model returned three grounded points, preserving the same synthetic project name and color. In each trial a text-only Realtime session acknowledged inserted history, then a bounded text response recalled both facts. No microphone or audio generation was used, and no private archived transcript was sent by these probes. The existing ignored key worked with the final model. This establishes the tested text/schema path, not spoken WebRTC recall, live capture completeness, long-session summary accuracy, or latency.
- **Rollout / data:** services run on 4317/4318; health returned HTTP 200 with the configured model and 2700-second limit. Schema v3 was initialized without rewriting transcript rows. The preactivation archive contained zero turn rows and existing deletion tombstones; they were preserved, not restored. A synthetic ready summary/turn was inserted solely for browser preview, then removed through the normal deletion API. The post-cleanup turn checksum matched the preactivation archive, with no pending summaries. No credentials, database, or synthetic transcript artifacts were added to version control.
- **Docs / handoff:** README and DESIGN now describe selected-history usage, costs, failure behavior, bounds and source-linked 30-day retention. The 28-step ID/link/fence audit and `git diff --check` passed. V26/V27 remain in progress for their stated remaining UI/listening checks; V21/V22 retain the previous real-capture/viewer acceptance gaps. Next: make a short saved voice conversation containing a distinctive fact, End immediately after the final words, verify capture, prepare its preview, and ask about the fact in a new selected-context voice session. Verify a fresh/no-save session receives no selected context. Changes remain uncommitted.

## Workflow references

This is a lightweight project convention, not a file structure Codex requires automatically. It adapts ideas from [OpenAI's Codex best practices](https://learn.chatgpt.com/guides/best-practices), [independently verifiable execution plans](https://developers.openai.com/cookbook/articles/codex_exec_plans), and [development workflow examples](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex).


### 2026-10-16 — History organization, deletion confirmation and concise titles

- **Scope:** user requested manual categories, confirmation before deletion, removal of unhelpful capture badges, investigation of an irrelevant spoken answer, and a concise conversation title from the existing summary work. Implementation stayed separate from active voice in a temporary copy; activation occurred while the browser showed Ready to talk.
- **V28 complete:** schema v4 adds user-named categories and one nullable category assignment per conversation. Create, rename, assign and remove work in grouped history; startup context selection uses the same groups. Removing a category moves its conversations to Uncategorized without changing transcript revisions, summaries or model context. Names are trimmed, bounded to 60 characters, unique without ASCII case distinctions, and limited to 50 categories. No category model calls or dependencies were added.
- **Deletion:** every history row exposes Delete, followed by a timestamp-specific confirmation with Delete permanently and Cancel. Detail deletion uses the same confirmation. An active voice session blocks deletion of its own capture or selected sources; unrelated archived conversations remain deletable. Category removal separately explains that conversations stay saved. Browser checks opened and cancelled deletion without removing personal data; disposable API/SQLite tests exercise actual deletion and late-write protection.
- **Capture presentation:** removed generic capture-warning badges from list and startup picker, and moved session diagnostics into collapsed Transcript details. Interrupted and missing-transcription turns retain concise labels. An empty completed ASR result is no longer classified as a missing final event; old historical flags are retained because past completeness cannot be re-certified. This presentation change does not guarantee complete capture or reconstruct missing words.
- **Title extension to V25:** the same structured summary response now returns a title in the conversation's main language, capped at 80 characters and tied to valid source turn IDs. Long jobs choose the final title in the existing merge request. Titles appear above dates/counts in history and the startup picker; changed source revisions hide stale titles. Legacy ready summaries remain usable without titles until explicit Generate title; pending jobs show preparation status and the visible panel polls GET requests for at most three minutes. Reading history never schedules a model call. New titles add output to the existing request, not another model. Explicit legacy title preparation regenerates its summary and incurs API usage. Repeated preparation requests cannot start overlapping runner timers.
- **Offline verification:** final temporary-copy and root `npm run check` passed TypeScript, 91 tests across eight files, and production client/server builds. New coverage includes real v3-to-v4 SQLite migration/reopen, category assignment/removal/content preservation and validation, empty-final versus pending transcription, title length/language/reference validation, multi-section title merging, legacy opt-in generation, unchanged-revision reuse, stale-title suppression, API validation and single in-flight summary work. `git diff --check` and documentation-link/fence/step checks passed.
- **Browser verification:** created a disposable category, assigned two synthetic conversations, confirmed grouped counts, renamed it, checked grouped startup selection, and inspected removal confirmation. Removing that category preserved both conversations in Uncategorized. A synthetic pending title updated to its completed Chinese title without manual Refresh; the title also appeared in the context picker. Delete confirmation and Cancel remained functional. Fresh-session defaults were restored. This checks UI and polling; the published UI result came from the separate synthetic provider check, not a second browser-triggered paid request.
- **Live provider verification:** one bounded request to the configured `gpt-5.6-terra` returned a concise Chinese title and three points from a synthetic SQLite-versus-Redis discussion, with valid source references. No private archived transcript, microphone input or audio generation was used. This confirms the tested schema and example wording; it does not establish accuracy for every long conversation.
- **Irrelevant-answer investigation:** the inspected exchange's provider item links placed the assistant answer immediately after the name question; simple display reordering was not supported by that evidence. Realtime processes audio directly while the displayed input transcript is a separate asynchronous transcription and may differ from the audio model's interpretation ([official reference](https://developers.openai.com/api/reference/cli/resources/realtime)). An audio interpretation mismatch is plausible, but the exact historical cause is unproven because raw audio was not retained. Interrupted status explains cut-off playback, not topic relevance. Added a name-versus-capabilities listening scenario; no prompt change or claimed spoken fix was made.
- **Rollout and data:** services remain loopback-only on 4317/4318 with the 2700-second limit. All synthetic category/title fixtures were removed. The remaining 21 turn rows and one summary matched the preactivation SHA-256 checksum; user-deleted conversations were not restored. Credentials, runtime data and screenshots were not staged. Changes remain uncommitted. V21/V22/V26/V27 retain their previously documented broader live/manual acceptance limits.


### 2026-10-16 — Automatic history/titles and compact controls

- **Updated user requirements:** generate titles automatically, remove the top prototype banner/readiness badge, simplify category management, always include previous conversations, remove the saving checkbox, and reduce helper-text/history spacing. These instructions supersede the earlier opt-in history and saving-off-as-fresh-start policies. iPhone work remains set aside.
- **Titles and saving:** the UI always requests transcript saving. End still preserves the bounded final-turn drain before scheduling a title/summary, so title generation cannot certify missing speech. The background runner backfills ended untitled/legacy records in batches of up to 100 and does not reset exhausted current-revision attempts. No Generate title button remains. A bounded opening excerpt provides an immediate label until a model title is ready. History refreshes when a capture starts/ends; polling restarts after End so a long session does not leave its title stale merely because an earlier poll window elapsed. No extra title model or live per-turn summary call was introduced.
- **Automatic continuity:** Start chooses the three most recent eligible ended sources from retained history, using ready summaries and finalized excerpts under the existing 6,000-byte UTF-8 cap. A pending or failed summary uses bounded excerpts immediately; startup never waits for new summary generation. Each source gets a compact excerpt before optional points fill the budget, and omission notices remain in the injected data. Current requests take priority over historical topics. The manual checkbox/picker/preview UI was removed; internal explicit-selection endpoints remain available for fixture verification. This is recent-three continuity, not exhaustive whole-archive retrieval.
- **Startup safety and saving-off API:** microphone tracks are muted throughout setup and unmuted only after any injected context is acknowledged. Unavailable history stops setup with a clear retry message. Revision/source reservations and deletion protection remain in place. The internal saving-off API now also loads history, using a transient server handle for source protection but no transcript observer, durable new conversation, or summary job. End releases that transient handle immediately. The UI no longer exposes this optional path.
- **UI:** only the wordmark remains in the top bar. Category management uses a + Category creation popover and a heading-level ··· menu; rename/remove forms appear only for the chosen category. Empty categories remain manageable. Escape/outside click dismiss menus, and category removal still confirms that conversations are retained. History has reduced padding/gaps, shorter dates and inline metadata when space permits. The measured panel height at the same 1280-pixel layout width fell from 227.5 to 140.84 pixels (about 38%). Persistent storage/memory/API helper text moved to the collapsed Privacy & memory footer; idle voice controls no longer reserve blank save-status space.
- **Offline verification:** final `npm run check` passed TypeScript, 99 tests across eight files, and production client/server builds. Added coverage for automatic legacy title backfill, exhausted-job preservation, opening-excerpt bounds without transcript rewriting, automatic recent-three selection, long bilingual context bounds and per-source contribution, pending-summary fallback, saving-off history/source deletion protection with no observer or content writes, history-read failure before provider credential creation, automatic context acknowledgment/microphone gating, immediate unsaved cleanup, and empty-category menus. Provider/microphone operations were mocked; tests never read personal archive content. Git whitespace and documentation checks passed.
- **Browser verification:** confirmed absence of the prototype banner, duplicated readiness badge, saving/history checkboxes, manual preview and title buttons. A disposable empty category was created and renamed through the compact popovers; Escape closed the menu and restored focus. Removal confirmation was inspected and cancelled, then only that test category was removed through the API. Confirmed the optional privacy panel opens and closes, the compact date/row layout, and no horizontal document overflow at the current 1280-pixel viewport. The user-created additional category was preserved.
- **Data and rollout:** services remain on loopback 4317/4318, with the 2700-second session limit. At cleanup, the original 21 turn rows matched their SHA-256 snapshot and existing category assignments were unchanged. No personal conversations were deleted or restored; no synthetic conversations were inserted for this increment. Existing ended conversations already had titles, so the automatic rollout needed no paid backfill request. No agent microphone session or new live-provider recall experiment was run. Previously documented synthetic text/schema checks still apply, but audible automatic recall and real final capture remain pending human acceptance. Changes are uncommitted.


### 2026-10-16 — Replace transcript diagnostics with a concise summary

- **Scope:** implemented the user's approved replacement of Transcript details with Summary. Removed the generic missing-final-transcription and ordering diagnostics from the transcript view; capture records, source flags and live saving-error behavior were not changed.
- **Display:** reuses the saved background summary already returned by the conversation API. Whole points prioritize the topic, a decision and an open question, then fill from remaining points when needed. The paragraph is bounded to three points and 480 characters without cutting a point mid-sentence or reconstructing missing speech. The section is compact and open by default. Active/pending/empty/unavailable summaries have brief neutral text; superseded source revisions are never displayed. The existing GET polling also covers ended conversations whose summary job has not yet appeared.
- **Verification:** `npm run check` passed TypeScript, 102 tests across nine files and client/server production builds. Added synthetic rendering checks for concise topic/decision/question selection, diagnostic exclusion, stale/failed summary suppression, bilingual punctuation, whole-point length bounds, and active/pending/empty states. Browser inspection of the existing conversation verified Summary above the turns and absence of Transcript details and its two generic messages. Existing category/deletion controls and per-turn interruption indicators remain visible. Git whitespace/document checks passed.
- **Data and limits:** the rollout required no backend restart, new model call, microphone input or synthetic archive record. Transcript and summary rows matched their pre-change checksum. This is a presentation change using existing generated content; it does not repair missing historical speech or establish capture completeness. Changes remain uncommitted.


### 2026-10-17 — Python backend migration and provider/local-app boundaries

- **Authorization and shutdown:** user explicitly requested stopping Voxa and rewriting the backend in Python while preserving functionality, abstracting OpenAI and preparing for BrainShuffle. Stopped the existing 4317/4318 processes before work. SQLite backup and an original-server source archive were saved under ignored `data/migration-backup/`; no private archive material was added to fixtures or documentation.
- **Implementation:** replaced the Node/Fastify server with a uv-locked Python/FastAPI package. Existing `/api` field names/SDP routes, local Host/Origin protections, body limits, error sanitization, session defaults and saving-off API remain. SQLite uses a dedicated single worker with bounded submissions; capture queues, final 12-second drain, observer retries, categories, deletion tombstones, retention, automatic recent-three memory and durable summary/title jobs were ported. Graceful shutdown additionally flushes already-received turns. Browser resource lifecycle remains in TypeScript; vendor wire operations moved to a transport adapter without a visual redesign.
- **Provider boundary:** independent VoiceProvider/SummaryProvider ports and normalized observer observations isolate provider HTTP/WebSocket details. OpenAI is the only installed vendor; core API tests inject a fixture vendor with different model names. Provider selection fails explicitly for unimplemented names. Other voice protocols require their own browser adapter; this is documented rather than claiming every model is interchangeable. Existing `.env` and key were left unchanged.
- **BrainShuffle:** inspected its actual local FastAPI problem/review schemas read-only. Added an optional loopback-only, bounded problem reader and configuration-status route, plus a versioned conversation export. The reader omits hidden reference notes, verifies identity, disables redirects and uses a three-second deadline. No startup connection, automatic sync, grading, upload, shared database or BrainShuffle source/process changes occur. Its current API lacks a conversation-summary importer; a future explicit study/write-back flow is separate work.
- **Parity evidence:** before retiring the legacy source, its existing suite passed (104 tests including two moved category grouping tests). Captured synthetic reference outputs from that implementation for 37 transcript sequences and repository operations; Python matches them. Final `npm run check` passes 31 browser/helper tests and 129 Python tests, TypeScript, Ruff lint/format, Vite build and Python source/wheel builds. Tests cover real SQLite lock isolation, versions 1–4/reopen, future-schema rejection, cancellation/queue bounds, late turns after End, one-use handles, source protection, context expiry/revision/Unicode caps, stale/expired summary claims, retries, refusals, chunk merging, provider credential/call ownership/errors and BrainShuffle contracts. These are offline synthetic checks, not new live-provider speech experiments.
- **Runtime/browser evidence:** `uv sync --locked` succeeded. Started the Python API and Vite using `npm run dev`; direct and proxied health returned HTTP 200 with the existing key configured and 2700-second limit. Origin rejection and disabled BrainShuffle status passed. Browser reload showed enabled Start, the existing grouped archive/categories/title/count, the saved summary and all 21 turns. Opened Delete confirmation, cancelled it, and returned to the collapsed idle view. No microphone or paid provider call was initiated. The built wheel includes schema/prompt resources and excludes runtime data; an isolated wheel install passed startup, health, missing-key and empty-archive smoke checks.
- **Data/final state:** all four archive tables were checked against the pre-migration logical SHA-256 snapshot; original turns, summary, categories, assignments and tombstones were unchanged. Services were stopped again after verification, per the user’s request. `npm run dev` now launches Python plus Vite. Changes are uncommitted. V29 remains in progress only for the stated human listening/final-capture/recall check; prior V03–V05/V21/V22/V26/V27 live/manual limits are not certified by migration fixtures.


### 2026-10-17 — Group frontend/backend and fix Pyrefly discovery

- **Root cause:** reproduced the reported diagnostic with `pyrefly dump-config`: its default root-layout heuristic selected the React `src/` directory and the global Conda interpreter. Pydantic 2.14.1 already imported successfully from the project `.venv`; the reported missing import came from editor/type-checker discovery. Declared Pydantic directly, added a locked Pyrefly development dependency, and configured the actual backend interpreter/search roots. Full checking exposed 11 additional optional-value/test-fixture inference issues; fixed them with guards, a typed context section and correct test narrowing/monkeypatching, without disabling diagnostics.
- **Layout:** browser files, npm manifests, configs, modules, build and shared browser types moved into `frontend/`. Python now uses `backend/src/voxa/`, with tests, pyproject/uv lock, `.python-version`, `.venv`, `.env`, example environment and archive data all under `backend/`. Recreated the local virtual environment after moving the package, keeping the previous environment/build output in ignored migration-backup storage. The root now contains only frontend, backend, docs, README, AGENTS, Makefile and Git metadata. No global editor settings changed.
- **Commands and discovery:** root `make install`, `make dev`, `make check` and `make build` replace the old root npm commands. `make frontend` and `make backend` run each app independently. Relative archive overrides resolve from the backend project; default storage and environment lookup no longer depend on the caller’s shell directory. Pyrefly explicitly uses backend `.venv/bin/python`, `src` and `tests`, with source-root guessing disabled. README, agent instructions, design and migration contract reflect the new paths and commands.
- **Verification:** `make install` passed from the reorganized root using both lockfiles. Final `make check` passed TypeScript, 31 frontend tests, 131 Python tests, Ruff lint/format, full Pyrefly with zero errors, Vite build and Python source/wheel builds. Added tests for backend source/environment/data path discovery from a different working directory. The Python package includes its schema/prompt resources and excludes credentials/archive/backups. Pyrefly per-file config discovery also resolves imports using the backend configuration.
- **Smoke/data/state:** `make dev` started both services on loopback 4317/4318; direct/proxied health, existing key configuration, 2700-second limit and retained conversation/category API reads passed. No microphone/provider request or BrainShuffle sync was initiated. The key file was moved byte for byte; all four SQLite tables still match the pre-migration logical checksum. `.env`, archive, dependencies and build outputs remain ignored in their new folders. Stopped both services afterward; V29’s human listening checks remain separate and pending. Changes are uncommitted.


### 2026-10-17 — Flatten the backend source directory

- **Request:** remove the extra package directory beneath `backend/src/`. Moved its contents directly into `backend/src/`, keeping provider and integration modules grouped beneath that source root.
- **Wiring:** Python imports now use the `src` package. Updated the `voxa` console entry point, Uvicorn application path, wheel package selection, Pyrefly import roots, test imports/monkeypatch targets, and backend-root discovery. Environment and archive paths still resolve to `backend/.env` and `backend/data/`, independent of the caller’s working directory. Updated current README/agent/migration guidance; earlier log entries describe their historical layouts.
- **Verification:** rebuilt the editable installation and ran `make check`: 31 frontend tests and 131 backend tests passed; TypeScript, full Pyrefly (zero errors), Ruff and frontend/Python package builds passed. `make backend` successfully started the flattened console entry; health recognized the existing key and retained history loaded. The built wheel contains `src/main.py` and the summary resources, without the old package prefix. All archive tables matched the original logical checksum. Stopped the API afterward; no microphone/provider call, data rewrite or commit occurred.


### 2026-10-17 — Regression, dead-code and complexity audit

- **Baseline and scope:** inspected application composition, capture/save queues, SQLite operations, summary/context bounds, provider adapter, media lifecycle, history/category UI, package layout and verification tooling. The original `make check` passed 162 tests. Passing those checks did not expose the confirmed edge cases below. Existing uncommitted work was retained; no provider/model change, conversation rewrite, BrainShuffle activation or commit was made.
- **P1: long/malformed transcript ordering:** a valid 1,500–2,000-item chain arriving in reverse order raised Python RecursionError, breaking detail, summary and history eligibility paths. Replaced recursive ordering with an iterative predecessor walk. Cycles now conservatively mark every affected member uncertain rather than allowing partially ordered cycle members into summary evidence. Stored turns are not mutated. Removed the unused browser copy of ordering; the server remains the ordering owner.
- **P2: summary bounds:** escaped control text reproduced an empty chunk followed by a 36,052-byte chunk despite the 24,000-byte budget. Piece sizing now accounts for serialized JSON. Multi-section merge requests could separately exceed that budget; they now select points round-robin within the cap, disclose omissions, and validate final references against supplied merge evidence. The OpenAI adapter uses the same compact JSON encoding as the budget calculation; no extra model request was added.
- **P2: history/health races and title refresh:** a delayed transcript request could overwrite the view selected by a newer active-session refresh. Consolidated navigation, external refresh and polling under one abortable request owner, tracking selection before its fetch resolves. Ended untitled records with no summary status now poll instead of waiting for manual Refresh. Obsolete Strict Mode health responses are ignored after effect cleanup. Browser fixtures cover these races, delayed title preparation, category reassignment and deletion confirmation; actual deletion is confined to synthetic fixtures. Corrected the stale setup instruction from root npm commands to `make dev` and `backend/.env`.
- **P2: package environment/storage lookup:** a wheel’s package path resolves inside site-packages, so deriving runtime files only from source location missed the launch directory’s environment/database. Editable source still resolves its project; installed packages use the working directory. An isolated wheel install in a temporary directory recognized a synthetic environment key, read an empty local archive and closed resources correctly, without reading personal configuration or making provider requests.
- **P2: shutdown/expiry:** serial per-capture flush waits multiplied the shutdown delay by the number of sessions. Queues now flush concurrently under their existing individual deadline, with final cleanup in a finally block. AsyncExitStack closes storage/HTTP resources even if another cleanup fails. Expired setup credentials are rejected locally rather than being sent to the provider; unused handles expire at the credential’s deadline. Removed duplicate observer-gap writes.
- **Cleanup and lint:** removed an unused study-source Protocol, obsolete capture-notice CSS and a repeated error-message condition; simplified managed/direct signaling selection. Retained provider ports and internal summary/context/no-save APIs because they are intentional parity/integration contracts. Added locked Oxlint browser correctness and React-hook checking to `make check`, without suppressing diagnostics or forcing incompatible TypeScript peer dependencies. A Vulture pass found no additional high-confidence unused Python code. Standard npm installation first hit the existing user authentication configuration; the documented public-registry/userconfig override succeeded without changing global settings.
- **Verification:** final `make check` passed 36 frontend tests and 139 backend tests (175 total), browser lint, TypeScript, Ruff lint/format, full Pyrefly with zero errors, Vite and Python package builds. All new regression cases were demonstrated against the relevant prior behavior where applicable; fixed cases pass. Clean `npm ci` with the documented public-registry override succeeded. A separate isolated installed-wheel smoke check verified package resources, environment discovery, local storage and lifecycle cleanup. Synthetic provider/media mocks were used; no paid OpenAI or microphone experiment was run.
- **Browser/data/final state:** the audited app started through `make dev`; Start, grouped retained history, title/count, Summary and transcript detail loaded. Opened deletion confirmation and cancelled, returned to history, verified loading settled and controls were enabled, then restored the collapsed idle view. No personal data was deleted or moved. All four archive tables still match the original logical SHA-256 snapshot. Services were stopped after verification; prior human listening/final-ASR/recall acceptance remains pending in V29 and related steps. Changes remain uncommitted.
