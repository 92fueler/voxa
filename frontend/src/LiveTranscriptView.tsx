import type { LiveTurn } from './live-transcript';

export function LiveTranscriptView({ turns }: { turns: LiveTurn[] }) {
  if (!turns.length) return null;
  return <details className="live-transcript" open>
    <summary>Your live transcript</summary>
    <p className="history-note">Draft text may change. Finalized text is not a save confirmation; check Saved conversations for the archive.</p>
    <ol>{turns.map(turn => <li key={turn.itemId}>
      <span className={`caption-state ${turn.status}`}>{turn.status === 'final' ? 'Finalized' : turn.status === 'draft' ? 'Draft · may change' : 'Unconfirmed · final text not received'}</span>
      <p>{turn.text || (turn.status === 'final' ? 'No speech transcribed.' : 'Waiting for transcript.')}</p>
    </li>)}</ol>
  </details>;
}
