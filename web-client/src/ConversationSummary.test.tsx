import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SummaryPoint, SummaryRecord } from './shared/continuity';
import { ConversationSummary } from './ConversationSummary';

const point = (kind: SummaryPoint['kind'], text: string): SummaryPoint => ({ kind, text, sourceTurnIds: ['synthetic_u'] });
const record = (points: SummaryPoint[]): SummaryRecord => ({ status: 'ready', sourceRevision: 7, value: { points, warnings: ['INTERNAL_CAPTURE_DIAGNOSTIC'], sourceRevision: 7, model: 'synthetic', createdAt: 1 } });
const render = (summary?: SummaryRecord | null, revision = 7, ended = true, turnCount = 2) => renderToStaticMarkup(<ConversationSummary summary={summary} revision={revision} ended={ended} turnCount={turnCount} />);

describe('concise transcript summary', () => {
  it('shows topic, decision and next question without capture diagnostics or extra facts', () => {
    const html = render(record([point('fact', 'EXTRA_FACT'), point('open_question', '下一步如何测量延迟？'), point('topic', 'We discussed caching'), point('decision', 'We chose SQLite') ]));
    expect(html).toContain('We discussed caching. We chose SQLite. 下一步如何测量延迟？');
    expect(html).not.toContain('EXTRA_FACT'); expect(html).not.toContain('INTERNAL_CAPTURE_DIAGNOSTIC'); expect(html).not.toContain('Transcript details');
  });
  it('never displays summary text from a superseded source revision', () => {
    const old = record([point('topic', 'STALE_SUMMARY')]);
    const html = render(old, 8);
    expect(html).toContain('Preparing summary…'); expect(html).not.toContain('STALE_SUMMARY');
    expect(render({ ...old, status: 'failed' })).toContain('Summary unavailable.');
    expect(render({ ...old, status: 'failed' })).not.toContain('STALE_SUMMARY');
  });
  it('keeps whole points within the paragraph bound and handles pending, active and empty conversations', () => {
    const text = 'A'.repeat(230);
    const html = render(record([point('topic', text), point('decision', 'B'.repeat(230)), point('open_question', 'C'.repeat(230))]));
    expect(html).toContain(text + '.'); expect(html).toContain('B'.repeat(230) + '.'); expect(html).not.toContain('C'.repeat(230));
    expect(render(null)).toContain('Preparing summary…');
    expect(render(record([point('topic', 'NOT_FINISHED')]), 7, false)).toContain('Available after this conversation ends.');
    expect(render(record([]))).toContain('No summary available for this conversation.');
    expect(render(null, 7, true, 0)).toContain('No conversation text to summarize.');
  });
});
