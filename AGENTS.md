# Working on Voxa

## Context

- Read `README.md`, `docs/DESIGN.md`, and the selected step in `docs/PLANS.md` before work.
- `docs/DESIGN.md` owns product and architecture intent. `docs/PLANS.md` owns step scope, status, decisions, and verification evidence.
- The primary product interaction is audio input and spoken output.
- Runtime: Python 3.12+ managed by uv (3.13 selected locally), plus Node.js 22.13+ and npm for React/Vite. Install both projects with `make install`, develop with `make dev`, and verify with `make check` (browser lint, TypeScript, full Pyrefly checking, Python lint/format, both offline test suites, frontend build and Python package). See `README.md` for setup and API-key instructions.
- Frontend: `http://127.0.0.1:4317`; backend: `http://127.0.0.1:4318`. Do not use port 5173. Keep both services bound to loopback and report port conflicts instead of taking over another application's port.
- Backend code lives in `backend/src/`; provider wire/API logic belongs in `providers/`, local-app connectors in `integrations/`. Run one API process: call handles and context reservations are process-local. Do not share BrainShuffle's database or add automatic sync without a defined product flow.
- Frontend source and npm configuration live in `frontend/`; Python source, uv configuration, `.venv`, `.env` and runtime data live in `backend/`. Keep root-level project orchestration in `Makefile`. Pyrefly must use the backend environment and source roots, not the React `src/`.
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
