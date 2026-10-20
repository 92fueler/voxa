import { useEffect, useState } from 'react';
import { isSummaryPreview, type ContextPreview } from './shared/continuity';
interface Snapshot { key: string; preview: ContextPreview | null; error: string; settled: boolean }

export function useConversationMemory(active: boolean) {
  const [selected, setSelected] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', preview: null, error: '', settled: false });
  const key = JSON.stringify([selected, active, revision]);
  const current = snapshot.key === key;
  useEffect(() => {
    if (active || !selected.length) return;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout>;
    // Coalesce checkbox changes. Loading ready summaries makes no model request.
    const timer = setTimeout(() => {
      void fetch('/api/context/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, summariesOnly: true }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      }).then(async response => {
        const value = await response.json() as ContextPreview & { error?: string };
        if (!response.ok) throw new Error(value.error || 'Could not load selected summaries.');
        if (!isSummaryPreview(value, selected)) throw new Error('Selected summaries are not ready.');
        if (controller.signal.aborted) return;
        setSnapshot({ key, preview: value, error: '', settled: true });
        expiry = setTimeout(() => setSnapshot({ key, preview: null, error: 'Selected summaries expired. Retry before Start.', settled: true }), Math.max(0, value.expiresAt - Date.now()));
      }).catch((problem: unknown) => {
        if (!controller.signal.aborted) setSnapshot({ key, preview: null, error: problem instanceof Error ? problem.message : 'Could not load selected summaries.', settled: true });
      });
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(expiry); };
  }, [selected, active, key]);

  function select(ids: string[]) {
    if (active) return;
    const next = [...new Set(ids)];
    setSelected(previous => previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next);
  }
  const invalidate = () => setRevision(value => value + 1);
  return {
    selected, preview: !active && current ? snapshot.preview : null,
    loading: !active && selected.length > 0 && !(current && snapshot.settled),
    error: !active && current ? snapshot.error : '',
    select, retry: invalidate, consume: invalidate,
  };
}
export type ConversationMemory = ReturnType<typeof useConversationMemory>;
