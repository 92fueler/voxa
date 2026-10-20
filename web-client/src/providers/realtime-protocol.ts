import type { CaptionEvent } from '../live-transcript';
import type { TurnStyle } from '../turn-style';
import { isExpectedCleanupError } from '../shared/realtime-errors';

/** Browser transport adapter. A new vendor wire format implements this interface. */
export interface RealtimeEvent {
  caption?: CaptionEvent;
  contextItemId?: string; inputActive?: boolean; failed?: boolean; errorCode?: string;
  userTranscript?: { id: string; text: string }; responseActive?: boolean; outputActive?: boolean;
  acknowledgedStyle?: TurnStyle; styleRejected?: string;
}

export interface RealtimeProtocol {
  dataChannelName: string;
  isCredential(value: unknown): value is string;
  cancel(): object;
  commit(): object;
  context(itemId: string, text: string): object;
  turnStyle(style: TurnStyle, eventId: string): object;
  event(raw: unknown): RealtimeEvent;
  directCall(value: string, sdp?: string): { url: string; body?: string; headers: Record<string, string> };
}

const openai: RealtimeProtocol = {
  dataChannelName: 'oai-events',
  isCredential: (value): value is string => typeof value === 'string' && value.startsWith('ek_'),
  cancel: () => ({ type: 'response.cancel', event_id: 'voxa_end_cancel' }),
  commit: () => ({ type: 'input_audio_buffer.commit', event_id: 'voxa_end_commit' }),
  context: (itemId, text) => ({ type: 'conversation.item.create', event_id: 'voxa_load_context', item: { id: itemId, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }),
  turnStyle: (style, eventId) => ({ type: 'session.update', event_id: eventId, session: { type: 'realtime', audio: { input: { turn_detection: { type: 'semantic_vad', eagerness: style === 'thinking' ? 'low' : 'medium', create_response: true, interrupt_response: true } } } } }),
  event: raw => {
    if (!raw || typeof raw !== 'object') return {};
    const event = raw as { type?: string; item?: { id?: string }; item_id?: unknown; transcript?: unknown; delta?: unknown; content_index?: unknown; event_id?: unknown; error?: { code?: unknown; event_id?: unknown }; session?: { audio?: { input?: { turn_detection?: { eagerness?: unknown } } } } };
    const eagerness = event.session?.audio?.input?.turn_detection?.eagerness;
    const styleRejected = event.type === 'error' && typeof event.error?.event_id === 'string' && /^voxa_turn_style_[0-9]{1,5}$/.test(event.error.event_id) ? event.error.event_id : undefined;
    const captionKinds: Record<string, CaptionEvent['kind']> = {
      'input_audio_buffer.speech_started': 'start',
      'conversation.item.input_audio_transcription.delta': 'delta',
      'conversation.item.input_audio_transcription.completed': 'final',
      'conversation.item.input_audio_transcription.failed': 'failed',
    };
    const kind = captionKinds[event.type || ''];
    const index = event.content_index ?? 0;
    const text = kind === 'delta' ? event.delta : event.transcript;
    const caption: CaptionEvent | undefined = kind && typeof event.item_id === 'string' && event.item_id.length > 0 && event.item_id.length <= 256 && typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 16 &&
      ((kind === 'start' || kind === 'failed') || (typeof text === 'string' && text.length <= 32000))
      ? { kind, itemId: event.item_id, index, ...(typeof text === 'string' ? { text } : {}), ...(typeof event.event_id === 'string' && event.event_id.length <= 256 ? { eventId: event.event_id } : {}) } : undefined;
    return {
      caption,
      ...(event.type === 'conversation.item.done' ? { contextItemId: event.item?.id } : {}),
      ...(event.type === 'input_audio_buffer.speech_started' ? { inputActive: true } : {}),
      ...(['input_audio_buffer.speech_stopped', 'input_audio_buffer.committed'].includes(event.type || '') ? { inputActive: false } : {}),
      ...(caption?.kind === 'final' ? { userTranscript: { id: caption.itemId, text: caption.text ?? '' } } : {}),
      ...(event.type === 'response.created' ? { responseActive: true } : {}),
      ...(event.type === 'response.done' ? { responseActive: false } : {}),
      ...(event.type === 'output_audio_buffer.started' ? { outputActive: true } : {}),
      ...(['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type || '') ? { outputActive: false } : {}),
      ...(event.type === 'session.updated' && (eagerness === 'low' || eagerness === 'medium') ? { acknowledgedStyle: eagerness === 'low' ? 'thinking' : 'everyday' } : {}),
      styleRejected,
      failed: event.type === 'error' && !styleRejected && !isExpectedCleanupError(event),
      ...(event.type === 'error' && typeof event.error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(event.error.code) ? { errorCode: event.error.code } : {}),
    };
  },
  directCall: (value, sdp) => ({ url: 'https://api.openai.com/v1/realtime/calls', body: sdp, headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' } }),
};

export function realtimeProtocol(name: unknown = 'openai-realtime-v1'): RealtimeProtocol {
  if (name === 'openai-realtime-v1') return openai;
  throw new Error('The server returned an unsupported voice transport.');
}
