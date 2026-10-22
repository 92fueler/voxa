import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authorizationHeader,
  checkBackend,
  DEFAULT_BACKEND_URL,
  HealthCheckError,
  parseBackendOrigin,
  parseHealth,
} from './backend.ts';

const health = {
  status: 'ok',
  realtimeConfigured: false,
  model: 'test-model',
  sessionMaxSeconds: 2700,
} as const;

const jsonResponse = (body: unknown = health, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function hasCode(code: HealthCheckError['code']) {
  return (error: unknown) => error instanceof HealthCheckError && error.code === code;
}

test('accepts only HTTPS origins or the documented local simulator origin', () => {
  assert.equal(parseBackendOrigin(' https://voice.example/ '), 'https://voice.example');
  assert.equal(parseBackendOrigin(DEFAULT_BACKEND_URL), DEFAULT_BACKEND_URL);
  assert.equal(parseBackendOrigin('http://localhost:4318'), 'http://localhost:4318');
});

for (const value of [
  '',
  'voice.example',
  'ftp://voice.example',
  'http://voice.example',
  'http://192.168.1.2:4318',
  'http://127.0.0.1:3000',
  'http://localhost.evil.example:4318',
  'https://username:password@voice.example',
  'https://voice.example/api',
  'https://voice.example?token=private',
  'https://voice.example#private',
  'https://voice.example\\@other.example',
  'https://voice.\nexample',
]) {
  test(`rejects unsafe or unsupported origin ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseBackendOrigin(value), hasCode('configuration'));
  });
}

test('local checks omit authorization; remote Basic is built only from transient explicit inputs', () => {
  assert.equal(authorizationHeader(DEFAULT_BACKEND_URL), undefined);
  assert.equal(authorizationHeader(DEFAULT_BACKEND_URL, { username: '', password: '' }), undefined);
  assert.equal(
    authorizationHeader('https://voice.example', { username: 'test-user', password: 'synthetic-not-a-real-password' }),
    `Basic ${Buffer.from('test-user:synthetic-not-a-real-password').toString('base64')}`,
  );
});

test('never sends credentials over HTTP, accepts no partial credentials or malformed Basic username', () => {
  assert.throws(() => authorizationHeader(DEFAULT_BACKEND_URL, { username: 'user', password: 'test' }), hasCode('configuration'));
  for (const credentials of [
    { username: 'user', password: '' },
    { username: '', password: 'test' },
    { username: 'user:other', password: 'test' },
    { username: 'user', password: '秘密' },
    { username: 'user', password: 'test\n' },
  ]) {
    assert.throws(() => authorizationHeader('https://voice.example', credentials), hasCode('configuration'));
  }
});

test('Basic encoding supports every base64 padding length without browser or Node globals', () => {
  for (let length = 1; length <= 64; length += 1) {
    const password = 'test-~!$&()_+=?/:'.repeat(5).slice(0, length);
    assert.equal(
      authorizationHeader('https://voice.example', { username: 'user', password }),
      `Basic ${Buffer.from(`user:${password}`).toString('base64')}`,
    );
  }
});

test('validates the full health contract rather than trusting success HTML or loose casts', () => {
  assert.deepEqual(parseHealth({ ...health, ignoredExtraField: true }), health);
  for (const value of [
    null,
    'ok',
    { status: 'ok' },
    { ...health, realtimeConfigured: 'true' },
    { ...health, status: 'unavailable' },
    { ...health, model: '' },
    { ...health, model: 'x'.repeat(129) },
    { ...health, sessionMaxSeconds: 0 },
    { ...health, sessionMaxSeconds: 2701 },
    { ...health, sessionMaxSeconds: 30.5 },
  ]) {
    assert.throws(() => parseHealth(value), hasCode('response'));
  }
});

test('sends exactly one read-only health request without cookies, provider calls, or Origin', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls += 1;
    assert.equal(url, `${DEFAULT_BACKEND_URL}/api/health`);
    assert.equal(init?.method, 'GET');
    assert.deepEqual(init?.headers, { Accept: 'application/json' });
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    return jsonResponse();
  };
  assert.deepEqual(await checkBackend(DEFAULT_BACKEND_URL, { fetcher }), health);
  assert.equal(calls, 1);
});

test('remote request uses Basic only on the specified HTTPS origin', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://voice.example/api/health');
    assert.deepEqual(init?.headers, {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from('user:synthetic-password').toString('base64')}`,
    });
    return jsonResponse({ ...health, realtimeConfigured: true });
  };
  const result = await checkBackend('https://voice.example', {
    credentials: { username: 'user', password: 'synthetic-password' },
    fetcher,
  });
  assert.equal(result.realtimeConfigured, true);
});

test('invalid URL or insecure credentials never reach fetch', async () => {
  const fetcher: typeof fetch = async () => { assert.fail('Unexpected network request'); };
  await assert.rejects(checkBackend('http://192.168.0.1:4318', { fetcher }), hasCode('configuration'));
  await assert.rejects(checkBackend(DEFAULT_BACKEND_URL, {
    fetcher,
    credentials: { username: 'user', password: 'synthetic-password' },
  }), hasCode('configuration'));
});

for (const status of [401, 403, 503]) {
  test(`handles HTTP ${status} without exposing the server error body`, async () => {
    await assert.rejects(checkBackend('https://voice.example', {
      fetcher: async () => jsonResponse({ detail: 'private diagnostic' }, status),
    }), error => hasCode(status === 503 ? 'response' : 'authentication')(error)
      && !(error as Error).message.includes('private diagnostic'));
  });
}

test('rejects HTML login pages and malformed JSON', async () => {
  await assert.rejects(checkBackend(DEFAULT_BACKEND_URL, {
    fetcher: async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
  }), hasCode('response'));
  await assert.rejects(checkBackend(DEFAULT_BACKEND_URL, {
    fetcher: async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  }), hasCode('response'));
});

test('rejects a redirected response even if a native transport ignored redirect:error', async () => {
  const response = jsonResponse();
  Object.defineProperty(response, 'redirected', { value: true });
  Object.defineProperty(response, 'url', { value: 'https://other.example/api/health' });
  await assert.rejects(checkBackend('https://voice.example', {
    fetcher: async () => response,
  }), hasCode('response'));
});

test('does not expose native error details', async () => {
  await assert.rejects(checkBackend(DEFAULT_BACKEND_URL, {
    fetcher: async () => { throw new Error('secret internal detail'); },
  }), error => hasCode('network')(error) && !(error as Error).message.includes('secret internal detail'));
});

const waitForAbort: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});

test('aborts an unresponsive request at its deadline', async () => {
  await assert.rejects(checkBackend(DEFAULT_BACKEND_URL, { fetcher: waitForAbort, timeoutMs: 5 }), hasCode('timeout'));
});

test('external cancellation aborts a request and a pre-cancelled check never fetches', async () => {
  const controller = new AbortController();
  const promise = checkBackend(DEFAULT_BACKEND_URL, { fetcher: waitForAbort, signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, hasCode('cancelled'));
  await assert.rejects(checkBackend(DEFAULT_BACKEND_URL, {
    signal: controller.signal,
    fetcher: async () => { assert.fail('Unexpected network request'); },
  }), hasCode('cancelled'));
});
