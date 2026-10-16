# Voxa development plan

Status: the user accepted the current local voice prototype as the MVP on October 16, 2026. V00–V02 are complete; V03–V04 have implementation and offline checks, with detailed live/manual acceptance still pending. V05 has a patient-default adjustment; its remaining controls and live checks are pending. The rest of the plan remains not started. The plan itself does not authorize paid experiments.

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

- [ ] V06 — Normalize transcript events with offline fixtures.
- [ ] V07 — Calculate usage costs from offline fixtures.
- [ ] V23 — Collect live usage and apply session budgets.
- [ ] V08 — Measure response and interruption latency.
- [ ] V09 — Deliver teach-back behavior.
- [ ] V10 — Add English-expression practice.
- [ ] V24 — Compare voice models before adding memory.
- [ ] V11 — Add mock-interview behavior.
- [ ] V12 — Add guided-learning behavior.

### C. Add continuity and bounded context

- [ ] V13 — Add the session repository with a no-save policy.
- [ ] V21 — Connect live transcripts to incremental persistence.
- [ ] V22 — Display saved sessions and transcript limitations.
- [ ] V14 — Generate evidence-backed post-session review.
- [ ] V15 — Select learning memory for the next session.
- [ ] V16 — Enforce retention and delete derived data.
- [ ] V17 — Bound context and inspect cache behavior.
- [ ] V18 — Restore selected context after a replacement connection.

### D. Validate the MVP and decide on expansion

- [ ] V19 — Validate long-session behavior and the MVP.
- [ ] V20 — Evaluate phone and Bluetooth use.

## Step definitions

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

**Dependencies:** V01, V06, V07, V24 (quality decision gate). **Provider calls:** none for this step's verification.

**Deliverable:** SQLite session/turn/usage records and a small repository interface. Use application identities distinct from provider session/item IDs. Support idempotent writes, transcript revisions, incomplete-session markers, and a no-save policy. Choose storage paths ignored by Git. No-save excludes durable conversation content and personal memory reads; content-free usage metadata follows DESIGN.md.

**Verify:** insert synthetic records, restart/reopen the database, replay duplicate/reordered writes, and retry a failed transaction. Confirm correct revisions, isolation between sessions, and no durable conversation content for a no-save session. Schema initialization/migration must preserve existing records. No provider connection or UI is needed.

**Outside scope:** live event wiring, transcript UI, raw audio, sync, review generation. V21 and V22 own integration and display.

### V14 — Post-session review

**Dependencies:** V00, V13, V21. **Provider calls:** required for evaluator-quality validation, not for schema/retry tests.

**Deliverable:** a review over an identified transcript revision: summary, strengths, possible gaps, useful expressions, practice suggestions, and source-turn references. Persist pending/complete/failed state and recover pending jobs after restart. Treat transcript text as data, not evaluator instructions. Retry without duplicates; reject results for deleted sessions or superseded revisions. No-save sessions create no review jobs.

**Verify:** validate output structure/reference existence with fixtures; test timeout, restart, retry, and late transcript updates. Human-review correct, incorrect, and uncertain transcripts with the actual evaluator. Exclude interrupted assistant text when its heard boundary is unknown. A stale job cannot overwrite newer review evidence or recreate a deleted session. Live voice remains responsive during review.

**Outside scope:** automatic permanent learning-note promotion; V15 owns that policy.

### V15 — Learning memory

**Dependencies:** V13, V14, V22. **Provider calls:** none for selection logic; one next-session behavior check.

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

**Deliverable:** create a new session with selected summary and recent finalized turns after connection loss or planned rollover. Preserve application identity while changing provider identity; insert restored turns as supported text context, not invented audio history. No-save continuation uses only surviving in-memory state and does not reload saved personal memory.

**Verify:** force a replacement connection with a short test timeout rather than paying for an hour of waiting. Confirm the new session retains a chosen fact, does not duplicate transcript turns, and releases the old microphone/connection. Confirm rollover timing against the provider limit when implementing. Check that a no-save session can use surviving transient context but offers a fresh start after a browser restart rather than restoring private content from disk.

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

**Dependencies:** V03, V04, V06, V13, V23. **Provider calls:** required for a short transcription check.

**Deliverable:** wire optional input transcription and finalized live events into the session repository. Expose unsaved state, retry idempotently, and use a bounded end-of-session drain. Late events advance the transcript revision and invalidate affected review results. No-save uses transient state only.

**Verify:** save a bilingual exchange, interrupt output, force a save failure, and end before a transcription completes. Check revisions, ordering, unknown heard boundaries, and retry behavior. No-save leaves no conversation content after end. Missing events remain incomplete, and browser closure limitations are documented.

**Outside scope:** session browsing UI, evaluator, or guaranteed server-side capture.

### V22 — Saved-session display

**Dependencies:** V13. **Provider calls:** none.

**Deliverable:** a simple list/detail view over saved synthetic or real records, showing transcript text, incomplete/interrupted turns, and source-expiry limitations. Provide the UI foundation for later learning-note controls.

**Verify:** inspect fixtures for a complete, incomplete, interrupted, expired, and empty session. User/assistant speakers and pending/unsaved states are distinguishable, and uncertain text is not presented as confirmed delivered speech. Confirm no-save content cannot be reopened.

**Outside scope:** live event transport, review generation, full editing, or analytics dashboards.

### V23 — Live usage and session budgets

**Dependencies:** V03, V04, V07. **Provider calls:** a short bounded wiring check.

**Deliverable:** adapt provider usage events to V07's calculation contract, deduplicate response identities, and expose an estimated session total. Add configurable duration/estimated-spend limits. Use transient collection before storage integration; never log message content with usage.

**Verify:** replay repeated, cancelled, partial, and unknown-model usage events. Test the duration limit and estimated-spend overshoot with a fake clock/events; stopping must release resources. In a short live session, match recorded categories to received provider events. Unknown usage is visibly incomplete and cannot disable the independent duration limit. Do not claim invoice reconciliation or an exact spending cutoff.

**Outside scope:** SQLite wiring, invoice APIs, subscriptions, and a hard provider-side spending guarantee.

### V24 — Early voice-model comparison

**Dependencies:** V00, V05, V08, V09, V10, V23. **Provider calls:** required within an established short experiment budget.

**Deliverable:** compare full and Mini on teach-back and English-expression scenarios before persistence/memory work. Freeze prompts, VAD profiles, scenario order/repetitions, and critical-failure criteria before the experiment. Record exploratory timing/cost and choose a provisional model or document that neither is acceptable.

**Verify:** human-reviewed results cover correct and incorrect technical explanations, mixed languages, pauses, and interruptions. Investigate critical failures before selecting a default; do not hide them behind an average score. If neither meets the rubric, record a design revision rather than proceeding with a false pass. This can complete as an experiment with a negative result; subsequent learning-memory work should wait for a sound voice foundation.

**Outside scope:** long-session statistics, all-mode acceptance, storage, and guaranteed quality claims.

## Dependency order and decision gates

One valid order is V00 → V01 → V02 → V03 → V04 → V05 → V06 → V07 → V23 → V08 → V09 → V10 → V24 → V11 → V12 → V13 → V21 → V22 → V14 → V15 → V16 → V17 → V18 → V19 → V20. Independent fixture work may be reordered when dependencies remain satisfied.

Before starting V13's saved-learning branch, review V24's result and resolve any critical voice-quality failure. This is a product decision gate, not a requirement to repeat permission requests for already-authorized work. Before accepting the full MVP, V19 must cover all four modes and the data lifecycle. If phone use is required, V20 is also part of acceptance.

## Suggested checkpoints

- **First audible value:** V03. A real spoken exchange exists before storage or learning infrastructure.
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

## Workflow references

This is a lightweight project convention, not a file structure Codex requires automatically. It adapts ideas from [OpenAI's Codex best practices](https://learn.chatgpt.com/guides/best-practices), [independently verifiable execution plans](https://developers.openai.com/cookbook/articles/codex_exec_plans), and [development workflow examples](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex).
