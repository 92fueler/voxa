import Fastify from 'fastify';
import type { ServerConfig } from './config.js';

const allowedHosts = new Set(['127.0.0.1:4318', 'localhost:4318']);
const allowedOrigins = new Set(['http://127.0.0.1:4317', 'http://localhost:4317']);

export function createServer(config: ServerConfig, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024, ajv: { customOptions: { removeAdditional: false } } });
  const providerFetch = options.fetch ?? fetch;

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!allowedHosts.has(request.headers.host ?? '') ||
        (request.headers.origin && !allowedOrigins.has(request.headers.origin))) {
      return reply.code(403).send({ error: 'This development API is available only from the local Voxa app.' });
    }
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    realtimeConfigured: Boolean(config.apiKey),
    model: config.model,
    sessionMaxSeconds: config.sessionMaxSeconds,
  }));

  app.post('/api/session', {
    schema: { body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (_request, reply) => {
    if (!config.apiKey) {
      return reply.code(503).send({
        error: 'Add OPENAI_API_KEY to the server .env file, then restart npm run dev.',
        code: 'API_KEY_REQUIRED',
      });
    }
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    try {
      const response = await providerFetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 60 },
          session: {
            type: 'realtime',
            model: config.model,
            output_modalities: ['audio'],
            instructions: 'You are Voxa, a personal voice learning companion. Speak naturally and concisely, usually in one to three sentences. Listen carefully, allow time to think, and ask one question at a time. Understand English, Mandarin, and mixed language. Match the language requested by the user. Say when you are uncertain. This is a basic voice conversation, not a scored assessment.',
            audio: {
              // Give unfinished explanations more time; this is not a fixed silence delay.
              input: { turn_detection: { type: 'semantic_vad', eagerness: 'low', create_response: true, interrupt_response: true } },
              output: { voice: 'marin' },
            },
            tracing: null,
          },
        }),
      });
      if (!response.ok) {
        // Never forward provider bodies: they may contain sensitive request details.
        return reply.code(502).send({ error: 'OpenAI could not create the voice session. Check the server key, billing, and model access.', code: 'PROVIDER_REJECTED' });
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('value' in data) || typeof data.value !== 'string' || !data.value.startsWith('ek_') ||
          !('expires_at' in data) || typeof data.expires_at !== 'number' || data.expires_at <= Date.now() / 1000) {
        return reply.code(502).send({ error: 'OpenAI returned an invalid session credential.', code: 'INVALID_CREDENTIAL' });
      }
      return { value: data.value, expiresAt: data.expires_at, sessionMaxSeconds: config.sessionMaxSeconds };
    } catch {
      return reply.code(signal.aborted ? 504 : 502).send({
        error: signal.aborted ? 'Session setup timed out. Try again.' : 'Could not reach OpenAI. Check your connection and try again.',
        code: signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
      });
    }
  });
  return app;
}
