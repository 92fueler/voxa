import { useEffect, useState } from 'react';
import type { SavedTurn } from './shared/transcript';
import type { SummaryRecord } from './shared/continuity';
import { groupConversations, type Category } from './shared/categories';
import { CategoryManager, CategoryMenu } from './CategoryManager';
import { ConversationSummary } from './ConversationSummary';
interface Conversation { previewText?: string | null; title?: string | null; summaryStatus?: 'pending' | 'running' | 'ready' | 'failed' | null; id: string; startedAt: number; endedAt: number | null; incomplete: number; revision: number; turnCount: number; issues: string[]; categoryId?: string | null }
interface Detail extends Conversation { turns: SavedTurn[]; summary?: SummaryRecord | null }
function needsSummary(value: Conversation | Detail): boolean {
  if (!value.endedAt) return true;
  if (!value.turnCount || value.summaryStatus === 'failed') return false;
  if ('turns' in value) return !value.summary || value.summary.sourceRevision !== value.revision || ['pending', 'running'].includes(value.summary.status) || !value.title;
  return !value.summaryStatus || ['pending', 'running'].includes(value.summaryStatus) || !value.title;
}

export function SavedConversations({ active, conversationId }: { active: boolean; conversationId?: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Conversation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [mutating, setMutating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const requestKey = JSON.stringify([selectedId, active, conversationId, refreshIndex]);
  const busy = mutating || (open && loadedKey !== requestKey);

  // One request owner handles navigation, automatic refresh and polling. Cleanup
  // prevents a slower response from replacing a more recently selected view.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const deadline = Date.now() + 180_000;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (!controller.signal.aborted && Date.now() < deadline) timer = setTimeout(() => void read(true), 3000);
    };
    const read = async (poll = false) => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
        const [response, categoryResponse] = await Promise.all([
          fetch(selectedId ? `/api/conversations/${selectedId}` : '/api/conversations', { signal }),
          poll ? Promise.resolve(null) : fetch('/api/categories', { signal }),
        ]);
        if (!response.ok || (categoryResponse && !categoryResponse.ok)) throw new Error('Storage unavailable');
        const value = await response.json() as Detail | Conversation[];
        const nextCategories = categoryResponse ? await categoryResponse.json() as Category[] : null;
        if (controller.signal.aborted) return;
        if (nextCategories) setCategories(nextCategories);
        if (selectedId) setDetail(value as Detail); else { setList(value as Conversation[]); setDetail(null); }
        setError(''); setLoadedKey(requestKey);
        if (Array.isArray(value) ? value.some(needsSummary) : needsSummary(value)) schedule();
      } catch {
        if (controller.signal.aborted) return;
        if (!poll) setError('Could not load saved conversations. Your voice session can continue.');
        setLoadedKey(requestKey);
        if (poll) schedule();
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, selectedId, requestKey]);

  function navigate(id?: string) {
    setSelectedId(id); setDetail(null); setDeleteTarget(null); setError(''); setLoadedKey('');
  }
  async function refresh() {
    setError(''); setDeleteTarget(null); setRefreshIndex(index => index + 1);
  }
  async function remove(id: string) {
    setMutating(true); setError('');
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      if (response.status === 409) { setError('End the voice session using this conversation, then wait for final saving before deleting it.'); return; }
      if (!response.ok) throw new Error('Delete failed');
      navigate(); await refresh();
    } catch { setError('Could not delete the conversation. Try again.'); }
    finally { setMutating(false); }
  }
  async function move(id: string, categoryId: string) {
    setMutating(true); setError('');
    try {
      const response = await fetch(`/api/conversations/${id}/category`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: categoryId || null }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(); await refresh();
    } catch { setError('Could not move the conversation. Refresh and try again.'); }
    finally { setMutating(false); }
  }
  const categoryChoice = (conversation: Conversation) => <select aria-label={`Category for ${new Date(conversation.startedAt).toLocaleString()}`} value={conversation.categoryId || ''} disabled={busy} onChange={event => void move(conversation.id, event.target.value)}>
    <option value="">Uncategorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
  </select>;
  const confirmation = (conversation: Conversation) => deleteTarget?.id === conversation.id && <div className="delete-confirmation" role="group" aria-label="Confirm conversation deletion">
    <p>Delete the conversation from {new Date(conversation.startedAt).toLocaleString()} and its summary? This cannot be undone.</p>
    <button className="button end" disabled={busy} onClick={() => void remove(conversation.id)}>Delete permanently</button>
    <button className="text-button" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button>
  </div>;
  return <section className="saved-conversations" aria-label="Saved conversations">
    <button className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>Saved conversations {open ? '−' : '+'}</button>
    {open && <div className="history-panel">
      <div className="history-heading"><h2>{selectedId ? 'Conversation transcript' : 'Your conversations'}</h2><button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
        {selectedId ? <button className="text-button" disabled={busy} onClick={() => navigate()}>Back to list</button> : <CategoryManager categories={categories} refresh={refresh} onError={setError} />}</div>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Loading…</p>}
      {!busy && !detail && list.length === 0 && !error && <p>No saved conversations yet.</p>}
      {!detail && groupConversations(list, categories, true).map(group => <section className="conversation-group" aria-label={group.name} key={group.id || 'uncategorized'}>
        <div className="category-group-heading"><h3>{group.name}<span>{group.conversations.length}</span></h3>{group.id && <CategoryMenu category={{ id: group.id, name: group.name }} refresh={refresh} onError={setError} />}</div>
        {group.conversations.map(item => <div className="history-entry" key={item.id}><div className="history-row">
          <div className="history-row-main"><button className="text-button" onClick={() => navigate(item.id)}>{item.title || item.previewText || 'New conversation'}</button>
            <p>{new Date(item.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {item.turnCount} {item.turnCount === 1 ? 'turn' : 'turns'}{!item.endedAt ? ' · Session not finalized' : ''}</p></div>
          {categoryChoice(item)}<button className="text-button history-delete" disabled={busy} aria-label={`Delete conversation from ${new Date(item.startedAt).toLocaleString()}`} onClick={() => setDeleteTarget(item)}>Delete</button>
        </div>{confirmation(item)}</div>)}
      </section>)}
      {detail && <>
        <h3 className="transcript-title">{detail.title || detail.previewText || 'New conversation'}</h3>
        <div className="history-detail-actions"><span className="history-summary">{detail.turnCount} {detail.turnCount === 1 ? 'turn' : 'turns'} saved</span>{categoryChoice(detail)}<button className="text-button history-delete" disabled={busy} onClick={() => setDeleteTarget(detail)}>Delete conversation</button></div>
        {confirmation(detail)}
        <ConversationSummary summary={detail.summary} revision={detail.revision} ended={Boolean(detail.endedAt)} turnCount={detail.turnCount} />
        {detail.turns.length === 0 && <p>No transcript turns were captured.</p>}
        <ol className="transcript-list">{detail.turns.map(turn => <li key={turn.itemId}>
          <div className="transcript-turn-heading"><strong>{turn.speaker === 'user' ? 'You' : 'Voxa'}</strong>
          {turn.status !== 'completed' && <span className="turn-status">{turn.status === 'interrupted' ? 'Interrupted' : 'Transcription not received'}</span>}
          {!turn.orderKnown && <span className="turn-status">Ordering uncertain</span>}</div>
          <p>{turn.text || (turn.status === 'completed' ? turn.speaker === 'user' ? 'No speech transcribed.' : 'No text returned.' : 'No transcript received for this turn.')}</p>
        </li>)}</ol>
        <p className="history-note">Transcripts can contain mistakes. Interrupted replies may include words that were not played.</p>
      </>}
      {active && <p className="history-note">End an active voice session before deleting its transcript or any past conversation it uses.</p>}
    </div>}
  </section>;
}
