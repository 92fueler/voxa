/** Only expected cleanup errors are safe to ignore; unknown provider errors remain failures. */
export function isExpectedCleanupError(event: { type?: unknown; error?: { code?: unknown; event_id?: unknown } }): boolean {
  return event.type === 'error' && (event.error?.code === 'response_cancel_not_active'
    || (event.error?.code === 'input_audio_buffer_commit_empty' && event.error.event_id === 'voxa_end_commit'));
}
