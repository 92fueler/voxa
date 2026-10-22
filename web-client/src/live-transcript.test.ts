import { expect, it } from 'vitest';
import { LiveTranscript } from './live-transcript';
import { realtimeProtocol } from './providers/realtime-protocol';

it('replaces bilingual drafts with exact finalized text and ignores late deltas/failures', () => {
  const captions = new LiveTranscript();
  captions.accept({ speaker: 'user', kind: 'delta', itemId: 'u', index: 0, text: '这个 cash' });
  expect(captions.snapshot()[0]).toMatchObject({ text: '这个 cash', status: 'draft' });
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'u', index: 0, text: '这个 cache 是缓存。' });
  captions.accept({ speaker: 'user', kind: 'delta', itemId: 'u', index: 0, text: ' wrong' });
  captions.accept({ speaker: 'user', kind: 'failed', itemId: 'u', index: 0 });
  expect(captions.snapshot()[0]).toMatchObject({ text: '这个 cache 是缓存。', status: 'final' });
});

it('reconciles out-of-order finals by item and content index, preserving speech-start order', () => {
  const captions = new LiveTranscript();
  captions.accept({ speaker: 'user', kind: 'start', itemId: 'first', index: 0 });
  captions.accept({ speaker: 'user', kind: 'start', itemId: 'second', index: 0 });
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'second', index: 0, text: '二' });
  captions.accept({ speaker: 'user', kind: 'delta', itemId: 'first', index: 1, text: 'draft' });
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'first', index: 0, text: 'first' });
  expect(captions.snapshot()[0].status).toBe('draft');
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'first', index: 1, text: '一' });
  expect(captions.snapshot()).toEqual([{ itemId: 'first', speaker: 'user', text: 'first\n一', status: 'final' }, { itemId: 'second', speaker: 'user', text: '二', status: 'final' }]);
});

it('does not promote missing or failed finals, including after End', () => {
  const captions = new LiveTranscript();
  captions.accept({ speaker: 'user', kind: 'delta', itemId: 'u', index: 0, text: 'uncertain' });
  captions.accept({ speaker: 'user', kind: 'failed', itemId: 'u', index: 0 });
  expect(captions.snapshot()[0].status).toBe('unconfirmed');
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'empty', index: 0, text: '' });
  captions.finish();
  expect(captions.snapshot()).toEqual([{ itemId: 'u', speaker: 'user', text: 'uncertain', status: 'unconfirmed' }, { itemId: 'empty', speaker: 'user', text: '', status: 'final' }]);
});

it('deduplicates event IDs without removing legitimate repeated words and bounds recent display', () => {
  const captions = new LiveTranscript();
  const event = { speaker: 'user' as const, kind: 'delta' as const, itemId: 'u', index: 0, text: '好', eventId: 'e1' };
  captions.accept(event); captions.accept(event);
  captions.accept({ ...event, eventId: 'e2' });
  expect(captions.snapshot()[0].text).toBe('好好');
  for (let n = 0; n < 8; n++) captions.accept({ speaker: 'user', kind: 'final', itemId: String(n), index: 0, text: String(n) });
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'u', index: 0, text: 'late' });
  expect(captions.snapshot().map(turn => turn.itemId)).toEqual(['2', '3', '4', '5', '6', '7']);
});

it('marks oversized content unconfirmed rather than silently finalizing a truncated value', () => {
  const captions = new LiveTranscript();
  captions.accept({ speaker: 'user', kind: 'delta', itemId: 'u', index: 0, text: 'x'.repeat(32000) });
  captions.accept({ speaker: 'user', kind: 'delta', itemId: 'u', index: 0, text: 'overflow' });
  expect(captions.snapshot()[0].status).toBe('unconfirmed');
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'u', index: 0, text: 'exact final' });
  expect(captions.snapshot()[0]).toMatchObject({ text: 'exact final', status: 'final' });
});

it('normalizes bounded input fields and excludes invalid captions and raw errors', () => {
  const protocol = realtimeProtocol();
  expect(protocol.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: '你好', content_index: 1 }).caption).toEqual({ speaker: 'user', kind: 'delta', itemId: 'u', index: 1, text: '你好' });
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

it('streams both speakers, replaces assistant drafts exactly and retains item-start order', () => {
  const captions = new LiveTranscript();
  const protocol = realtimeProtocol();
  const send = (event: object) => { const value = protocol.event(event).caption; expect(value).toBeDefined(); captions.accept(value!); };
  send({ type: 'input_audio_buffer.speech_started', item_id: 'u' });
  send({ type: 'response.output_item.added', response_id: 'r', item: { id: 'a', type: 'message', role: 'assistant' } });
  send({ type: 'response.output_audio_transcript.delta', response_id: 'r', item_id: 'a', content_index: 0, delta: 'A cash' });
  send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u', transcript: 'Explain cache.' });
  expect(captions.snapshot()).toEqual([
    { itemId: 'u', speaker: 'user', text: 'Explain cache.', status: 'final' },
    { itemId: 'a', speaker: 'assistant', text: 'A cash', status: 'draft' },
  ]);
  send({ type: 'response.output_audio_transcript.done', response_id: 'r', item_id: 'a', transcript: 'A cache stores reusable results. 缓存。' });
  expect(captions.snapshot()[1]).toMatchObject({ text: 'A cache stores reusable results. 缓存。', status: 'final' });
  send({ type: 'response.output_audio_transcript.delta', response_id: 'r', item_id: 'a', delta: 'late' });
  expect(captions.snapshot()[1].text).not.toContain('late');
});

it('retains interruption markers before late text and never applies them to another response or user', () => {
  const captions = new LiveTranscript();
  captions.interrupt({ responseId: 'old' });
  captions.accept({ speaker: 'assistant', kind: 'final', responseId: 'old', itemId: 'a', index: 0, text: 'May include unheard words.' });
  captions.accept({ speaker: 'assistant', kind: 'final', responseId: 'new', itemId: 'b', index: 0, text: 'New reply.' });
  captions.accept({ speaker: 'user', kind: 'final', itemId: 'u', index: 0, text: 'Wait.' });
  captions.interrupt({ itemId: 'u' });
  expect(captions.snapshot().map(turn => turn.status)).toEqual(['interrupted', 'final', 'final']);
  expect(captions.interrupt({ itemId: 'b' })).toBe(true);
  expect(captions.snapshot()[1].status).toBe('interrupted');
  expect(captions.interrupt({ itemId: 'b' })).toBe(false);
});

it.each([
  { type: 'output_audio_buffer.cleared', response_id: 'r' },
  { type: 'conversation.item.truncated', item_id: 'a' },
  { type: 'response.done', response: { id: 'r', status: 'cancelled' } },
  { type: 'response.done', response: { id: 'r', status: 'incomplete' } },
  { type: 'response.done', response: { id: 'r', status: 'failed' } },
])('marks an assistant transcript interrupted on $type rather than treating done text as played', event => {
  const captions = new LiveTranscript();
  captions.accept({ speaker: 'assistant', kind: 'final', responseId: 'r', itemId: 'a', index: 0, text: 'Generated response.' });
  const interruption = realtimeProtocol().event(event).interruption;
  expect(interruption).toBeDefined();
  captions.interrupt(interruption!);
  expect(captions.snapshot()[0].status).toBe('interrupted');
  expect(realtimeProtocol().event({ type: 'response.done', response: { id: 'r', status: 'completed' } }).interruption).toBeUndefined();
});

it('rejects assistant captions with invalid fields and tool output items', () => {
  for (const event of [
    { type: 'response.output_audio_transcript.delta', response_id: '', item_id: 'a', delta: 'x' },
    { type: 'response.output_audio_transcript.done', response_id: 'r', item_id: 'a', transcript: 'x', content_index: 17 },
    { type: 'response.output_audio_transcript.delta', response_id: 'r', item_id: 'a', delta: 'x'.repeat(32001) },
    { type: 'response.output_item.added', response_id: 'r', item: { id: 'tool', type: 'function_call' } },
  ]) expect(realtimeProtocol().event(event).caption).toBeUndefined();
});


it('rejects a conflicting speaker or response identity instead of replacing another turn', () => {
  const captions = new LiveTranscript();
  captions.accept({ speaker: 'assistant', kind: 'delta', responseId: 'r1', itemId: 'a', index: 0, text: 'Correct draft' });
  expect(captions.accept({ speaker: 'assistant', kind: 'final', responseId: 'r2', itemId: 'a', index: 0, text: 'Wrong response' })).toBe(false);
  expect(captions.accept({ speaker: 'user', kind: 'final', itemId: 'a', index: 0, text: 'Wrong speaker' })).toBe(false);
  captions.interrupt({ responseId: 'r1' });
  captions.accept({ speaker: 'assistant', kind: 'final', responseId: 'r1', itemId: 'a', index: 0, text: 'Correct final' });
  expect(captions.snapshot()).toEqual([{ speaker: 'assistant', itemId: 'a', text: 'Correct final', status: 'interrupted' }]);
});
