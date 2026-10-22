# Initial voice evaluation scenarios (V00)

These are synthetic inputs and planned human listening checks, not recorded model results. Run the same cases with each model and prompt version. Current app supports one basic conversation flow with dynamic pacing, explicit summary selection and microphone noise profiles; dedicated/scored learning modes and manual completion remain planned. Record microphone noise-filter choice and actual input device separately, VAD policy, browser, session duration, and repetitions before comparing results. Begin with three repetitions per selected case for exploratory comparison; this is not enough to establish reliable p95 latency or a population success rate.

## Review rubric

Score each applicable dimension as pass, partial, or fail, with one short observation: preservation of meaning, conceptual correctness, concise coaching, turn-taking, and the requested mode behavior. Mark not-applicable dimensions explicitly. Exact wording is not required.

Critical failures are confidently validating a known misconception, inventing a learner weakness after a correct explanation, changing the intended English meaning, or repeatedly speaking over a learner who has not finished. Do not select a default based only on an average score that conceals critical failures; inspect failures and revise/retest. An acceptable exploratory result contains no unresolved critical failure in the selected cases. This does not prove general reliability.

## Teach-back: correct explanations and misconceptions

### T01 — LRU cache, correct

Say: “An LRU cache can use a hash map and a doubly linked list. The map finds the node, and the list lets me move it to the front or remove the least recently used node. Lookup is expected constant time.”

Expected: recognize the basic explanation as correct; ask a focused follow-up, such as how capacity or concurrent access changes the implementation. Failure: insist that removing a known node from a doubly linked list necessarily takes a full traversal.

### T02 — LRU cache, incorrect

Say: “I use a singly linked list and scan it on every lookup. That guarantees constant-time cache lookup regardless of the number of entries.”

Expected: identify that scanning grows with entries and ask how the design could avoid the scan. Failure: validate guaranteed O(1) lookup without addressing the traversal.

### T03 — Retries, correct

Say: “If the request times out, I don't know whether the server performed the operation. Retrying a payment needs an idempotency key or some other deduplication policy.”

Expected: preserve the uncertainty about the first attempt; follow up on key scope or duplicate detection. Failure: claim the timeout proves the payment did not occur.

### T04 — Retries, incorrect

Say: “A timed-out payment request definitely failed before charging, so I can safely retry it with a new request ID every time.”

Expected: challenge the inference and describe or elicit a server-success/client-timeout counterexample. Failure: endorse the retry policy as inherently safe.

### T05 — Cache freshness, correct

Say: “A cache can serve older data. I need a freshness policy, and whether that is acceptable depends on the feature.”

Expected: agree with the core distinction and ask about a concrete requirement. Failure: claim all caches always return current database state.

### T06 — Cache freshness, incorrect

Say: “Adding a cache automatically gives me strongly consistent reads of the current database value.”

Expected: identify the missing invalidation/consistency assumptions. Failure: treat caching alone as a consistency guarantee.

## English expression

### E01 — Mixed-language meaning

Say: “我不想一直 context switch，因为会影响效率。How do I say that naturally?”

Expected: a natural English expression about avoiding frequent context switching because it hurts productivity; invite repetition. Failure: reverse the preference or replace the productivity concern with a different claim.

### E02 — Technical expression

Say: “我想说这个 design 比较简单，但以后扩展可能比较困难。”

Expected: preserve the trade-off between simplicity now and difficulty extending later. Failure: claim the design is currently complex or necessarily cannot scale.

### E03 — Ambiguity and retry

Say: “这个东西不太好。Help me say it professionally.” If asked, clarify: “I mean the proposal is missing a recovery strategy.” Then repeat the offered English with a small wording change.

Expected: clarify the vague criticism or offer conditional alternatives, then help phrase the recovery concern professionally. Feedback should address the repetition without claiming a calibrated pronunciation score. Failure: confidently invent a specific criticism before clarification.

## Conversation mechanics

### C01 — Thinking pauses

Explain a technical idea with two pauses of approximately two seconds and an unfinished phrase such as “The trade-off is… um…”. Run separately with patient and ordinary VAD profiles.

Expected: allow the explanation to continue; record each premature reply. Check manual completion only after that planned mode is implemented. Failure: repeated interruptions before the thought is complete. A single trial cannot establish an optimal VAD policy.

### C02 — Interrupt output

Ask for a short explanation, then interrupt with “Wait, explain that last part more simply.”

Expected: stop the prior response and respond to the new request. Mark the interrupted assistant turn incomplete; do not claim to know its exact heard-word boundary. Failure: continue talking over the interruption or silently archive all generated text as heard.

### C03 — Typing without speech (pending listening acceptance)

With the built-in microphone selected by the browser, choose Laptop microphone before Start. Ask for a short explanation and type normally while Voxa speaks, without speaking yourself. Repeat separately with earbuds selected by the browser and the Earbuds / headset filter. Record speech-start events/unconfirmed or empty captions and unintended playback cuts where observable; do not store private audio.

Expected: keyboard noise does not repeatedly cancel replies. Failure: Voxa cuts off while the user is silent, especially with empty detected user turns. Empty transcription and interrupted archive markers support investigation but do not independently prove which noise caused the event. Do not count a mocked session-update test as this listening result.

### C04 — Genuine and quiet bilingual interruption (pending listening acceptance)

For each matching microphone/filter setup, interrupt a reply with “Wait, explain that more simply,” then try “等一下，用中文解释。” Speak a short quiet sentence afterward at a normal usable distance.

Expected: real spoken interruption remains usable and quiet/mixed-language content is understood without requiring shouting. The live draft may change; exact provider final text replaces it and may contain ASR mistakes. Failure: filtering rejects ordinary quiet speech, loses important syllables, or makes interruption unusably slow. A final caption is not a save acknowledgment or proof of the exact audio-model interpretation.

### C05 — Switch microphone setups between calls

End the call, select a different physical input in the browser/OS, then choose the matching Microphone noise filter and Start again. Test laptop and headset in both orders. During connecting/connected voice, confirm that the filter selector is disabled. Reload only while idle and check that it returns to Laptop microphone.

Expected: the next call uses the selected profile without editing configuration or restarting services. The selector is a filter choice, not an input-device picker; changing hardware during a call is not automatically reclassified. Failure: profile changes clear selected memory, alter the active call or silently route a different device.

### C06 — Selected summaries and fresh-start isolation

Using disposable synthetic sources, prepare a category with ready ended summaries and an empty conversation. Select the category, unselect one ready source, review Selected insights, then Start. Separately clear all sources and start fresh. For the selected run, ask about a distinctive fact supported by an included point; also ask about an unselected source.

Expected: bulk selection checks ready sources and visibly explains exclusions; only selected summary points load, with no transcript fallback or automatic latest-three context. Context too large for every source to contribute blocks setup with a clear error. With synthetic empty-summary and oversized-selection fixtures, confirm the error lists each affected title/date and distinguishes empty insights from a combined size limit. Unselect one affected source directly from the error: other choices stay checked and reload automatically; no saved conversation is deleted. Clearing or changing selection must hide a late error from the old request. Start remains stable while previews load; early Start validates selection before acquiring the microphone. No-selection startup supplies no archive. Failure: unselected content appears, a source is silently omitted from the packet, or a preview failure silently starts without selected memory. Repeated checkbox edits must not exhaust unused-preview capacity; actual spoken recall remains a separate provider/listening check.

### C07 — Live-caption lifecycle at End and failure

During a disposable short call, observe a provisional caption, then End before its final result arrives. Repeat with a connection failure or short configured session expiry. Inspect the saved conversation after finalization; start a fresh call separately.

Expected: the live-caption panel disappears immediately when voice becomes inactive. Saving/finalizing/incomplete status remains independent, and the Saved conversations entry stays available. Late caption callbacks cannot resurrect the ended panel. A fresh call starts without old captions; late backend finals, when received, appear in its original saved transcript. Failure: “Live transcript” remains visible long after End, old captions reappear at the next Start, or unconfirmed text is fabricated into an apparently accurate post-call transcript.

### C08 — Both speakers in live captions

Ask a short question in English/Mandarin, watch the user final and Voxa’s response stream, then interrupt a reply. Also test an assistant answer containing a pacing-command phrase such as “give me more thinking time” as quoted content.

Expected: one Live transcript panel labels You and Voxa, assembles deltas separately by item/content index, and replaces them with exact final text without duplicate turns. Assistant text may appear ahead of speech; an interrupted reply retains an interruption warning even after its final text arrives. A late final for an older response must not mark a newer reply interrupted. Assistant text never changes pacing. End still removes both speakers’ live text. Failure: assistant text is missing, mixed into the user caption, triggers a pacing override, or is presented as exactly heard/saved speech.

## Additional modes

### M01 — Mock interview

Ask for a short system-design interview. Give a plausible answer with one explicit trade-off.

Expected: ask one question at a time, wait, and follow up on the trade-off. Failure: answer the interview question for the user or replace every answer with a long tutorial.

### G01 — Guided learning

Ask to understand hash collisions. Give a wrong answer, request a hint, then try again. Finally request a direct explanation.

Expected: adapt the hint and allow another attempt, then provide the direct explanation when requested. Failure: enforce endless questioning or ignore the learner's request.

## Result entry template

```text
Date / case / model / prompt version:
Actual input device / browser / microphone noise filter / VAD pace and override / repetition:
Dimension ratings and critical failures:
Observed behavior (brief; no private audio or transcripts):
Latency measurement or explicitly labeled proxy:
Usage completeness and estimated cost:
Decision / follow-up:
```

## Voice identity and relevance regression (pending live check)

Use synthetic English and Mandarin questions: “What is your name?”, “你叫什么名字？”, then separately “你知道些什么？”. Expected: identify as Voxa for the name questions; describe capabilities only for the capabilities question. Repeat with a speaker change and an interruption. A capabilities answer to a name question is a relevance failure even if the saved transcript correctly recognizes the question.

The Realtime model consumes audio directly; input transcription is a separate ASR result and cannot prove how the speech model interpreted the audio. The reported name-question incident had valid archived item ordering, so no simple viewer reordering defect was found. Audio is not retained, and the exact historical cause remains unproven. Do not claim that a prompt edit or a text-only test has fixed that spoken failure. No audio experiment was performed for this report.
