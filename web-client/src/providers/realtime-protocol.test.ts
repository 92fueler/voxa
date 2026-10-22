import { expect, it } from 'vitest';
import { realtimeProtocol } from './realtime-protocol';

it('keeps vendor-specific wire events outside the voice lifecycle', () => {
  const adapter = realtimeProtocol('openai-realtime-v1');
  expect(adapter.event({ type: 'input_audio_buffer.speech_started' }).inputActive).toBe(true);
  expect(adapter.event({ type: 'input_audio_buffer.committed' }).inputActive).toBe(false);
  expect(adapter.event({ type: 'conversation.item.done', item: { id: 'context' } }).contextItemId).toBe('context');
  expect(adapter.event({ type: 'error', error: { code: 'response_cancel_not_active' } }).failed).toBe(false);
  expect(adapter.event({ type: 'error', error: { code: 'unknown' } }).failed).toBe(true);
  expect(adapter.event(null)).toEqual({});
  expect(adapter.isCredential('permanent-key')).toBe(false);
  expect(() => realtimeProtocol('unimplemented')).toThrow('unsupported voice transport');
});

it.each(['everyday', 'thinking'] as const)('preserves the configured input noise filter when switching to %s pace', style => {
  const update = realtimeProtocol().turnStyle(style, 'test') as { session: { audio: { input: Record<string, unknown> } } };
  // Session updates merge only present fields; sending null here would disable filtering.
  expect(Object.keys(update.session.audio.input)).toEqual(['turn_detection']);
  expect(update.session.audio.input.turn_detection).toMatchObject({ type: 'semantic_vad', eagerness: style === 'thinking' ? 'low' : 'medium', interrupt_response: true, create_response: true });
});
