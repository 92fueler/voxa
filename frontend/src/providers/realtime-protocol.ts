import { isExpectedCleanupError } from '../shared/realtime-errors';

/** Browser transport adapter. A new vendor wire format implements this interface. */
export interface RealtimeProtocol {
  dataChannelName: string;
  isCredential(value: unknown): value is string;
  cancel(): object;
  commit(): object;
  context(itemId: string, text: string): object;
  event(raw: unknown): { contextItemId?: string; inputActive?: boolean; failed?: boolean };
  directCall(value: string, sdp?: string): { url: string; body?: string; headers: Record<string, string> };
}

const openai: RealtimeProtocol = {
  dataChannelName: 'oai-events',
  isCredential: (value): value is string => typeof value === 'string' && value.startsWith('ek_'),
  cancel: () => ({ type: 'response.cancel', event_id: 'voxa_end_cancel' }),
  commit: () => ({ type: 'input_audio_buffer.commit', event_id: 'voxa_end_commit' }),
  context: (itemId, text) => ({ type: 'conversation.item.create', event_id: 'voxa_load_context', item: { id: itemId, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }),
  event: raw => {
    if (!raw || typeof raw !== 'object') return {};
    const event = raw as { type?: string; item?: { id?: string }; error?: { code?: unknown; event_id?: unknown } };
    return {
      ...(event.type === 'conversation.item.done' ? { contextItemId: event.item?.id } : {}),
      ...(event.type === 'input_audio_buffer.speech_started' ? { inputActive: true } : {}),
      ...(['input_audio_buffer.speech_stopped', 'input_audio_buffer.committed'].includes(event.type || '') ? { inputActive: false } : {}),
      failed: event.type === 'error' && !isExpectedCleanupError(event),
    };
  },
  directCall: (value, sdp) => ({ url: 'https://api.openai.com/v1/realtime/calls', body: sdp, headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' } }),
};

export function realtimeProtocol(name: unknown = 'openai-realtime-v1'): RealtimeProtocol {
  if (name === 'openai-realtime-v1') return openai;
  throw new Error('The server returned an unsupported voice transport.');
}
