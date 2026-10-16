# voxa

Personal voice learning companion with audio input and spoken responses.

The first local voice prototype is implemented and accepted by the user as the current MVP. Voice sessions require an OpenAI API key; learning modes, transcripts, storage, and memory are still planned. Detailed live acceptance checks remain tracked in `docs/PLANS.md`.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open [Voxa](http://127.0.0.1:4317/). The API runs on `127.0.0.1:4318`. Both bind only to loopback; port conflicts stop startup. Port 5173 is not used.

The page and health endpoint work without credentials. Start is disabled until the backend has a key. No provider request occurs just by loading the page.

## Enable a real voice conversation

1. Copy `.env.example` to `.env` if the file does not already exist. The initial local setup may already have created an empty `.env`.
2. Set `OPENAI_API_KEY` in `.env` using your own editor. Do not paste the key into chat or put it in a `VITE_` variable.
3. Restart `npm run dev`, then use **Check again** in the app.
4. Start a conversation and allow microphone access. Speak a question, listen to the reply, then try a follow-up.
5. End the session and confirm the browser microphone indicator turns off.

API usage is separately billed and requires account/model access. The first trial defaults to two minutes, including provider connection time; `SESSION_MAX_SECONDS` permits 30–300 seconds. This browser timeout is a safety control, not an exact spending guarantee. Muting does not end the session.

The permanent key stays on the backend. The browser uses a short-lived credential for direct WebRTC audio with OpenAI. This prototype stores no conversations or recordings. The provider's own data controls still apply.

New conversations use patient turn detection (`semantic_vad`, `eagerness: low`) to allow more time during thinking pauses. It still estimates whether you have finished; it does not guarantee a minimum silence interval. Start a new conversation to pick up changes to these settings. A manual “done speaking” mode is planned in V05.

## Verify

```sh
npm run check
```

This runs TypeScript checks, mocked backend/media lifecycle tests, and client/server production builds. It makes no paid API calls. A passing result does not establish audible speech, bilingual quality, latency, or real browser microphone cleanup; those need the live/manual checks above.

Individual commands: `npm run typecheck`, `npm test`, and `npm run build`. The build emits files in `dist/`; the documented launch workflow is currently the local dev server, not a production deployment.

If your personal npm configuration returns an authentication error for these public packages, try `npm --userconfig=/dev/null --registry=https://registry.npmjs.org ci`. This does not modify your global npm settings.

## Repository layout

- `src/`: React interface and browser voice lifecycle.
- `server/`: local health/session API and server-only configuration.
- `docs/`: [design](docs/DESIGN.md), [development plan and evidence](docs/PLANS.md), and [conversation scenarios](docs/conversation-scenarios.md).
- [AGENTS.md](AGENTS.md): concise Codex repository instructions, kept at the root for discovery.

The design and plan distinguish proposals, offline verification, and live results. Follow the plan's dependencies and keep implementation changes focused.
