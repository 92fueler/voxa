export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:4318';

export interface BackendHealth {
  status: 'ok';
  realtimeConfigured: boolean;
  model: string;
  sessionMaxSeconds: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export class HealthCheckError extends Error {
  readonly code: 'configuration' | 'authentication' | 'response' | 'network' | 'timeout' | 'cancelled';

  constructor(
    message: string,
    code: HealthCheckError['code'],
  ) {
    super(message);
    this.name = 'HealthCheckError';
    this.code = code;
  }
}

/** The backend is mounted at an origin, not a path or query-string URL. */
export function parseBackendOrigin(value: string): string {
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HealthCheckError('Enter a complete backend URL, including https://.', 'configuration');
  }

  // Reject URL parser normalization of backslashes and invisible characters.
  if (/[\u0000-\u0020\\]/.test(input) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new HealthCheckError('Use only the backend origin, without credentials, a path, query, or fragment.', 'configuration');
  }

  const isLocal = (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '4318';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new HealthCheckError('Use HTTPS, or http://127.0.0.1:4318 for the iOS Simulator on your backend Mac.', 'configuration');
  }
  return url.origin;
}

export function authorizationHeader(origin: string, credentials?: Credentials): string | undefined {
  if (!credentials || (!credentials.username && !credentials.password)) return undefined;
  if (new URL(origin).protocol !== 'https:') {
    throw new HealthCheckError('Credentials are sent only over HTTPS. Local development does not need them.', 'configuration');
  }
  if (!credentials.username || !credentials.password) {
    throw new HealthCheckError('Enter both your backend username and password, or leave both empty.', 'configuration');
  }
  if (credentials.username.includes(':') || !/^[\x20-\x7E]+$/.test(credentials.username + credentials.password)) {
    throw new HealthCheckError('Use printable ASCII credentials; the username cannot contain a colon.', 'configuration');
  }
  return `Basic ${encodeAsciiBase64(`${credentials.username}:${credentials.password}`)}`;
}

// React Native does not guarantee a browser btoa global or a Node Buffer.
// Input has already been restricted to ASCII above.
function encodeAsciiBase64(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : 0;
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | (second >> 4)];
    encoded += index + 1 < value.length ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    encoded += index + 2 < value.length ? alphabet[third & 63] : '=';
  }
  return encoded;
}

export function parseHealth(value: unknown): BackendHealth {
  if (typeof value !== 'object' || value === null) {
    throw new HealthCheckError('The server did not return a valid Voxa health response.', 'response');
  }
  const health = value as Record<string, unknown>;
  if (
    health.status !== 'ok'
    || typeof health.realtimeConfigured !== 'boolean'
    || typeof health.model !== 'string'
    || !health.model.trim()
    || health.model.length > 128
    || typeof health.sessionMaxSeconds !== 'number'
    || !Number.isInteger(health.sessionMaxSeconds)
    || health.sessionMaxSeconds < 30
    || health.sessionMaxSeconds > 2700
  ) {
    throw new HealthCheckError('The server did not return a valid Voxa health response.', 'response');
  }
  return {
    status: 'ok',
    realtimeConfigured: health.realtimeConfigured,
    model: health.model,
    sessionMaxSeconds: health.sessionMaxSeconds,
  };
}

interface CheckOptions {
  credentials?: Credentials;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

/** Read-only: never creates a voice session or makes a provider request. */
export async function checkBackend(value: string, options: CheckOptions = {}): Promise<BackendHealth> {
  const origin = parseBackendOrigin(value);
  const authorization = authorizationHeader(origin, options.credentials);
  if (options.signal?.aborted) throw new HealthCheckError('Check cancelled.', 'cancelled');

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 8000);
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });

  try {
    const response = await (options.fetcher ?? fetch)(`${origin}/api/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (controller.signal.aborted) {
      throw new HealthCheckError('Check cancelled.', 'cancelled');
    }
    if (response.redirected || (response.url && response.url !== `${origin}/api/health`)) {
      throw new HealthCheckError('Use the final HTTPS backend origin. Redirected health endpoints are not supported.', 'response');
    }
    if (response.status === 401 || response.status === 403) {
      throw new HealthCheckError('Access was denied. Check the HTTPS backend origin and your backend credentials.', 'authentication');
    }
    if (!response.ok) {
      throw new HealthCheckError(`The backend returned HTTP ${response.status}.`, 'response');
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new HealthCheckError('Expected JSON from Voxa, not a login page or another service.', 'response');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new HealthCheckError('The server did not return valid JSON.', 'response');
    }
    if (controller.signal.aborted) throw new HealthCheckError('Check cancelled.', 'cancelled');
    return parseHealth(body);
  } catch (error: unknown) {
    if (timedOut) throw new HealthCheckError('The backend did not respond within 8 seconds. Check the URL and try again.', 'timeout');
    if (controller.signal.aborted) throw new HealthCheckError('Check cancelled.', 'cancelled');
    if (error instanceof HealthCheckError) throw error;
    // Do not show arbitrary server bodies, native exception details, or secrets.
    throw new HealthCheckError('Could not reach the backend. Check connectivity and the URL, then try again.', 'network');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
