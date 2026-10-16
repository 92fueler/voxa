export const MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'] as const;
export type RealtimeModel = (typeof MODELS)[number];

export interface ServerConfig {
  apiKey?: string;
  model: RealtimeModel;
  sessionMaxSeconds: number;
}

export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const model = env.REALTIME_MODEL || MODELS[0];
  if (!MODELS.includes(model as RealtimeModel)) {
    throw new Error('REALTIME_MODEL must be gpt-realtime-2.1 or gpt-realtime-2.1-mini.');
  }
  const sessionMaxSeconds = Number(env.SESSION_MAX_SECONDS || 120);
  if (!Number.isInteger(sessionMaxSeconds) || sessionMaxSeconds < 30 || sessionMaxSeconds > 300) {
    throw new Error('SESSION_MAX_SECONDS must be an integer between 30 and 300.');
  }
  return { apiKey: env.OPENAI_API_KEY?.trim() || undefined, model: model as RealtimeModel, sessionMaxSeconds };
}
