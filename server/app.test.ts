import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from './app.js';
import { readConfig } from './config.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(app => app.close())); });
const config = { apiKey: 'test-permanent-key', model: 'gpt-realtime-2.1' as const, sessionMaxSeconds: 120 };
function setup(apiKey: string | undefined = config.apiKey, timeoutMs?: number) {
  const fetchMock = vi.fn<typeof fetch>();
  const app = createServer({ ...config, apiKey }, { fetch: fetchMock, timeoutMs });
  servers.push(app);
  return { app, fetchMock, post: () => app.inject({ method: 'POST', url: '/api/session', headers: { host: '127.0.0.1:4318' }, payload: {} }) };
}

describe('local API', () => {
  it('serves health without calling a provider or exposing a key', async () => {
    const { app, fetchMock } = setup();
    const response = await app.inject({ url: '/api/health', headers: { host: '127.0.0.1:4318' } });
    expect(response.json()).toEqual({ status: 'ok', realtimeConfigured: true, model: config.model, sessionMaxSeconds: 120 });
    expect(response.body).not.toContain(config.apiKey);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing key without attempting a paid request', async () => {
    const { app, fetchMock } = setup('');
    const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'localhost:4318' }, payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('API_KEY_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns only temporary credentials and the client timeout', async () => {
    const { post, fetchMock } = setup();
    const expires = Math.floor(Date.now() / 1000) + 60;
    fetchMock.mockResolvedValue(Response.json({ value: 'ek_test', expires_at: expires, session: { instructions: 'private-provider-details' } }));
    const response = await post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ value: 'ek_test', expiresAt: expires, sessionMaxSeconds: 120 });
    expect(response.body).not.toContain(config.apiKey);
    expect(response.body).not.toContain('private-provider-details');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(request?.headers).toMatchObject({ Authorization: `Bearer ${config.apiKey}` });
    const body = JSON.parse(String(request?.body));
    expect(body.session.model).toBe(config.model);
    expect(body.session.output_modalities).toEqual(['audio']);
    expect(body.session.audio.output.voice).toBe('marin');
    expect(body.session.audio.input.turn_detection).toEqual({
      type: 'semantic_vad', eagerness: 'low', create_response: true, interrupt_response: true,
    });
    expect(body.session.tracing).toBeNull();
    expect(body.expires_after.seconds).toBe(60);
  });

  it.each([401, 429, 500])('does not forward sensitive provider error bodies (%s)', async status => {
    const { post, fetchMock } = setup();
    fetchMock.mockResolvedValue(new Response(`secret: ${config.apiKey}`, { status }));
    const response = await post();
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('PROVIDER_REJECTED');
    expect(response.body).not.toContain(config.apiKey);
  });

  it.each([
    { value: 'not-a-client-secret', expires_at: 9999999999 },
    { value: 'ek_test', expires_at: 1 },
    { value: 'ek_test' },
    null,
  ])('rejects invalid or expired credentials', async payload => {
    const { post, fetchMock } = setup();
    fetchMock.mockResolvedValue(Response.json(payload));
    expect((await post()).json().code).toBe('INVALID_CREDENTIAL');
  });

  it('bounds a stalled provider request', async () => {
    const { post, fetchMock } = setup(config.apiKey, 10);
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const response = await post();
    expect(response.statusCode).toBe(504);
    expect(response.json().code).toBe('PROVIDER_TIMEOUT');
  });

  it('sanitizes network failures', async () => {
    const { post, fetchMock } = setup();
    fetchMock.mockRejectedValue(new Error(config.apiKey));
    const response = await post();
    expect(response.json().code).toBe('PROVIDER_UNAVAILABLE');
    expect(response.body).not.toContain(config.apiKey);
  });

  it('rejects foreign origins and non-local hosts before creating credentials', async () => {
    const { app, fetchMock } = setup();
    for (const headers of [{ host: '127.0.0.1:4318', origin: 'https://unrelated.example' }, { host: 'rebinding.example:4318' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/session', headers, payload: {} })).statusCode).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not accept client-selected models or arbitrary session options', async () => {
    const { app, fetchMock } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/session', headers: { host: '127.0.0.1:4318' }, payload: { model: 'unexpected' } })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('starts without credentials and defaults to a two-minute full-model trial', () => {
    expect(readConfig({})).toEqual({ apiKey: undefined, model: config.model, sessionMaxSeconds: 120 });
  });
  it.each([{ REALTIME_MODEL: 'unknown' }, { SESSION_MAX_SECONDS: '0' }, { SESSION_MAX_SECONDS: '301' }, { SESSION_MAX_SECONDS: '1.5' }])('rejects invalid settings', env => {
    expect(() => readConfig(env)).toThrow();
  });
});
