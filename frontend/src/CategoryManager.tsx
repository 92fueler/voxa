import { useEffect, useRef, useState } from 'react';
import type { Category } from './shared/categories';
type Actions = { refresh: () => Promise<void>; onError: (message: string) => void };
function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, close]);
  return root;
}
function useCategoryChange({ refresh, onError }: Actions) {
  const [busy, setBusy] = useState(false);
  async function change(url: string, method: string, name?: string) {
    setBusy(true); onError('');
    try {
      const response = await fetch(url, { method, ...(name === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Could not update categories.'); }
      await refresh(); return true;
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not update categories.'); return false; }
    finally { setBusy(false); }
  }
  return { busy, change };
}
export function CategoryManager({ categories, ...actions }: Actions & { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { busy, change } = useCategoryChange(actions);
  const root = useDismiss(open, () => { if (!busy) setOpen(false); });
  return <div ref={root} className="category-actions">
    <button className="text-button" aria-expanded={open} disabled={busy || categories.length >= 50} onClick={() => setOpen(!open)}>+ Category</button>
    {open && <form className="category-popover" aria-label="Create category" onSubmit={event => { event.preventDefault(); void change('/api/categories', 'POST', name).then(ok => { if (ok) { setOpen(false); setName(''); } }); }}>
      <label htmlFor="new-category-name">Category name</label>
      <input id="new-category-name" autoFocus disabled={busy} maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. English practice" />
      <div><button className="text-button" disabled={busy || !name.trim()}>Create</button><button className="text-button" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
  </div>;
}
export function CategoryMenu({ category, ...actions }: Actions & { category: Category }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'remove' | null>(null);
  const [name, setName] = useState(category.name);
  const { busy, change } = useCategoryChange(actions);
  const root = useDismiss(mode !== null, () => { if (!busy) setMode(null); });
  return <div ref={root} className="category-actions">
    <button className="text-button category-more" aria-label={`Category options for ${category.name}`} aria-expanded={mode !== null} disabled={busy} onClick={() => setMode(mode ? null : 'menu')}>···</button>
    {mode === 'menu' && <div className="category-popover category-menu">
      <button className="text-button" onClick={() => { setName(category.name); setMode('rename'); }}>Rename</button>
      <button className="text-button history-delete" onClick={() => setMode('remove')}>Remove category</button>
    </div>}
    {mode === 'rename' && <form className="category-popover" aria-label={`Rename category ${category.name}`} onSubmit={event => { event.preventDefault(); void change(`/api/categories/${category.id}`, 'PATCH', name).then(ok => { if (ok) setMode(null); }); }}>
      <label htmlFor={`rename-${category.id}`}>Category name</label>
      <input id={`rename-${category.id}`} autoFocus maxLength={60} disabled={busy} value={name} onChange={event => setName(event.target.value)} />
      <div><button className="text-button" disabled={busy || !name.trim()}>Save</button><button className="text-button" type="button" disabled={busy} onClick={() => setMode(null)}>Cancel</button></div>
    </form>}
    {mode === 'remove' && <div className="category-popover" role="group" aria-label={`Remove category ${category.name}`}>
      <p>Remove “{category.name}”? Conversations stay saved in Uncategorized.</p>
      <button className="text-button history-delete" disabled={busy} onClick={() => void change(`/api/categories/${category.id}`, 'DELETE').then(ok => { if (ok) setMode(null); })}>Remove category</button>
      <button className="text-button" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
    </div>}
  </div>;
}
