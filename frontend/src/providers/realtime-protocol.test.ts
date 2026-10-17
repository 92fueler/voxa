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
