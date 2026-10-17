import type { SummaryPoint, SummaryRecord } from './shared/continuity';

/** Reuse whole evidence-linked points; this display never generates or reconstructs speech. */
function conciseText(points: SummaryPoint[]): string {
  const selected: string[] = [];
  const seen = new Set<string>();
  const priority: SummaryPoint['kind'][] = ['topic', 'decision', 'open_question', 'fact'];
  const add = (point: SummaryPoint) => {
    const text = point.text.trim().replace(/\s+/g, ' ');
    if (!text || seen.has(text)) return false;
    const sentence = /[.!?。！？]["'”’）)]*$/.test(text) ? text : text + (/[\u3400-\u9fff]/u.test(text) ? '。' : '.');
    if ([...selected, sentence].join(' ').length > 480) return false;
    selected.push(sentence); seen.add(text); return true;
  };
  for (const kind of priority) {
    points.filter(point => point.kind === kind).some(add);
    if (selected.length === 3) break;
  }
  for (const point of points) {
    if (selected.length === 3) break;
    add(point);
  }
  return selected.join(' ');
}

export function ConversationSummary({ summary, revision, ended, turnCount }: { summary?: SummaryRecord | null; revision: number; ended: boolean; turnCount: number }) {
  const current = summary?.sourceRevision === revision;
  const ready = ended && current && summary?.status === 'ready' && summary.value?.sourceRevision === revision;
  const text = ready ? conciseText(summary.value!.points) : '';
  const message = text || (!ended ? 'Available after this conversation ends.'
    : turnCount === 0 ? 'No conversation text to summarize.'
    : current && summary?.status === 'failed' ? 'Summary unavailable.'
    : ready ? 'No summary available for this conversation.' : 'Preparing summary…');
  return <section className="conversation-overview" aria-label="Conversation summary">
    <h4>Summary</h4>
    <p aria-live="polite">{message}</p>
  </section>;
}
