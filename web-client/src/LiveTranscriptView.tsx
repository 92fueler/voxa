import type { LiveTurn } from './live-transcript';

export function LiveTranscriptView({ turns }: { turns: LiveTurn[] }) {
  if (!turns.length) return null;
  return <details className="live-transcript" open>
    <summary>Live transcript</summary>
    <p className="history-note">Live text may change or appear ahead of speech. Finalized is not a save confirmation; check Saved conversations after the call.</p>
    <ol>{turns.map(turn => <li key={turn.itemId}>
      <div className="live-transcript-turn-heading"><strong>{turn.speaker === 'assistant' ? 'Voxa' : 'You'}</strong><span className={`caption-state ${turn.status}`}>{turn.status === 'final' ? 'Finalized' : turn.status === 'interrupted' ? 'Interrupted · some text may not have played' : turn.status === 'draft' ? turn.speaker === 'assistant' ? 'Responding…' : 'Draft · may change' : 'Unconfirmed · final text not received'}</span></div>
      <p>{turn.text || (turn.status === 'final' ? turn.speaker === 'assistant' ? 'No response text returned.' : 'No speech transcribed.' : 'Waiting for transcript.')}</p>
    </li>)}</ol>
  </details>;
}
