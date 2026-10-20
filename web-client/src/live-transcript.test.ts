import { expect, it } from 'vitest';
import { LiveTranscript } from './live-transcript';
import { realtimeProtocol } from './providers/realtime-protocol';

it('replaces bilingual drafts with exact finalized text and ignores late deltas/failures', () => {
  const captions = new LiveTranscript();
  captions.accept({ kind: 'delta', itemId: 'u', index: 0, text: '这个 cash' });
  expect(captions.snapshot()[0]).toMatchObject({ text: '这个 cash', status: 'draft' });
  captions.accept({ kind: 'final', itemId: 'u', index: 0, text: '这个 cache 是缓存。' });
  captions.accept({ kind: 'delta', itemId: 'u', index: 0, text: ' wrong' });
  captions.accept({ kind: 'failed', itemId: 'u', index: 0 });
  expect(captions.snapshot()[0]).toMatchObject({ text: '这个 cache 是缓存。', status: 'final' });
});

it('reconciles out-of-order finals by item and content index, preserving speech-start order', () => {
  const captions = new LiveTranscript();
  captions.accept({ kind: 'start', itemId: 'first', index: 0 });
  captions.accept({ kind: 'start', itemId: 'second', index: 0 });
  captions.accept({ kind: 'final', itemId: 'second', index: 0, text: '二' });
  captions.accept({ kind: 'delta', itemId: 'first', index: 1, text: 'draft' });
  captions.accept({ kind: 'final', itemId: 'first', index: 0, text: 'first' });
  expect(captions.snapshot()[0].status).toBe('draft');
  captions.accept({ kind: 'final', itemId: 'first', index: 1, text: '一' });
  expect(captions.snapshot()).toEqual([{ itemId: 'first', text: 'first\n一', status: 'final' }, { itemId: 'second', text: '二', status: 'final' }]);
});

it('does not promote missing or failed finals, including after End', () => {
  const captions = new LiveTranscript();
  captions.accept({ kind: 'delta', itemId: 'u', index: 0, text: 'uncertain' });
  captions.accept({ kind: 'failed', itemId: 'u', index: 0 });
  expect(captions.snapshot()[0].status).toBe('unconfirmed');
  captions.accept({ kind: 'final', itemId: 'empty', index: 0, text: '' });
  captions.finish();
  expect(captions.snapshot()).toEqual([{ itemId: 'u', text: 'uncertain', status: 'unconfirmed' }, { itemId: 'empty', text: '', status: 'final' }]);
});

it('deduplicates event IDs without removing legitimate repeated words and bounds recent display', () => {
  const captions = new LiveTranscript();
  const event = { kind: 'delta' as const, itemId: 'u', index: 0, text: '好', eventId: 'e1' };
  captions.accept(event); captions.accept(event);
  captions.accept({ ...event, eventId: 'e2' });
  expect(captions.snapshot()[0].text).toBe('好好');
  for (let n = 0; n < 8; n++) captions.accept({ kind: 'final', itemId: String(n), index: 0, text: String(n) });
  captions.accept({ kind: 'final', itemId: 'u', index: 0, text: 'late' });
  expect(captions.snapshot().map(turn => turn.itemId)).toEqual(['2', '3', '4', '5', '6', '7']);
});

it('marks oversized content unconfirmed rather than silently finalizing a truncated value', () => {
  const captions = new LiveTranscript();
  captions.accept({ kind: 'delta', itemId: 'u', index: 0, text: 'x'.repeat(32000) });
  captions.accept({ kind: 'delta', itemId: 'u', index: 0, text: 'overflow' });
  expect(captions.snapshot()[0].status).toBe('unconfirmed');
  captions.accept({ kind: 'final', itemId: 'u', index: 0, text: 'exact final' });
  expect(captions.snapshot()[0]).toMatchObject({ text: 'exact final', status: 'final' });
});

it('normalizes only bounded input-transcription fields and excludes assistant and raw errors', () => {
  const protocol = realtimeProtocol();
  expect(protocol.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: '你好', content_index: 1 }).caption).toEqual({ kind: 'delta', itemId: 'u', index: 1, text: '你好' });
  for (const event of [
    { type: 'response.output_audio_transcript.delta', item_id: 'a', delta: 'assistant' },
    { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: 'text', content_index: -1 },
    { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: 'x'.repeat(32001) },
    { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: { secret: 'private' } },
    { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u', transcript: 'Mock interview me', content_index: -1 },
    { type: 'conversation.item.input_audio_transcription.completed', item_id: '', transcript: 'Mock interview me' },
  ]) {
    expect(protocol.event(event).caption).toBeUndefined();
    expect(protocol.event(event).userTranscript).toBeUndefined();
  }
});
