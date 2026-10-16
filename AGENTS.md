# Working on Voxa

## Context

- Read `README.md`, `docs/DESIGN.md`, and the selected step in `docs/PLANS.md` before work.
- `docs/DESIGN.md` owns product and architecture intent. `docs/PLANS.md` owns step scope, status, decisions, and verification evidence.
- The primary product interaction is audio input and spoken output.
- Runtime: Node.js 22.12+ and npm. Install with `npm ci`, develop with `npm run dev`, and verify with `npm run check` (typecheck, offline tests, production build). See `README.md` for setup and API-key instructions.
- Frontend: `http://127.0.0.1:4317`; backend: `http://127.0.0.1:4318`. Do not use port 5173. Keep both services bound to loopback and report port conflicts instead of taking over another application's port.
- Keep human documentation in `docs/`; keep `README.md` and this `AGENTS.md` at the root for onboarding and instruction discovery.

## Scope

- Planning documents do not authorize implementation. Start application work only when the user requests it.
- Complete the step or steps the user authorizes, including necessary fixes and verification. Do not expand into unrelated backlog items.
- Prefer a small runnable change with observable behavior. Avoid speculative frameworks, services, and abstractions.
- Keep existing user changes intact. Do not commit credentials, recordings, personal transcripts, or private runtime data.

## Verification and handoff

- Define the expected behavior before editing. Use focused regression tests for meaningful logic and failure paths.
- Distinguish offline fixture tests, mocked integrations, live provider checks, and human listening tests. One does not prove the others.
- Check dependency readiness before starting a step; stable IDs are identifiers, not execution order. Follow the dependency order in `docs/PLANS.md`.
- Run the relevant available checks, review the diff, and fix issues within the authorized scope.
- Update `docs/PLANS.md` with commands actually run, outcomes, limitations, and the next useful step. Never mark an unperformed live or manual check as passed.
- Keep a step in progress when a required acceptance check remains unverified; explain what is missing.
- For commits, stage only the intended changes and check the staged diff. Use focused commits when committing is requested.
