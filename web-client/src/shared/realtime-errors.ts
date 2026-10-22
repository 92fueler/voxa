/** Only expected cleanup errors are safe to ignore; unknown provider errors remain failures. */
export function isExpectedCleanupError(event: { type?: unknown; error?: { code?: unknown; event_id?: unknown } }): boolean {
  return event.type === 'error' && (event.error?.code === 'response_cancel_not_active'
    || (event.error?.code === 'input_audio_buffer_commit_empty' && event.error.event_id === 'voxa_end_commit'));
}


const setupReasons: Record<string, string> = {
  PROVIDER_TIMEOUT: 'The connection request timed out. Try again.',
  PROVIDER_UNAVAILABLE: 'The server could not reach the voice service. Check the connection and try again.',
  PROVIDER_AUTH_FAILED: 'The voice service rejected authentication. Check the server API key and its permissions.',
  PROVIDER_QUOTA_EXCEEDED: 'The API account has no available quota. Check API billing or spending limits.',
  PROVIDER_RATE_LIMITED: 'The voice service is rate limited. Wait a moment and try again.',
  PROVIDER_MODEL_UNAVAILABLE: 'The configured voice model is unavailable to this API account. Check model access.',
  SESSION_SETUP_EXPIRED: 'Session setup expired. Start again.',
  AUTH_REQUIRED: 'Sign in to hosted Voxa, then try again.',
};

/** Both startup stages use fixed messages; arbitrary server text never reaches the UI. */
export function voiceSetupMessage(stage: 'session' | 'call', status: number, problem: unknown): string {
  const detail = problem && typeof problem === 'object' ? problem as { code?: unknown; providerStatus?: unknown } : {};
  const code = typeof detail.code === 'string' ? detail.code : '';
  if (stage === 'session') {
    if (['HISTORY_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'NO_CONTEXT', 'CONTEXT_LIMIT', 'SUMMARY_FAILED', 'SUMMARY_PENDING'].includes(code)) return 'Saved history is unavailable. Review your selection in Saved conversations and try again.';
    if (code.startsWith('PREVIEW_')) return 'Saved history changed during setup. Start again.';
    if (code === 'API_KEY_REQUIRED') return 'Add the server API key and restart the app to start a voice session.';
  }
  const providerStatus = typeof detail.providerStatus === 'number' && Number.isInteger(detail.providerStatus) && detail.providerStatus >= 400 && detail.providerStatus <= 599 ? ` (provider HTTP ${detail.providerStatus})` : '';
  const reason = Object.hasOwn(setupReasons, code) ? setupReasons[code] : status === 504 ? setupReasons.PROVIDER_TIMEOUT : `The service rejected the connection${providerStatus}. Try again.`;
  return `${stage === 'session' ? 'Could not create a session.' : 'The voice provider could not connect the voice call.'} ${reason}`;
}
