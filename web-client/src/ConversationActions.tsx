import { useEffect, useRef } from 'react';

export function ConversationActions({ title, disabled, onDelete }: { title: string; disabled: boolean; onDelete: () => void }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && root.current?.open) { root.current.open = false; root.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <details ref={root} className="conversation-actions">
    <summary aria-label={`Actions for ${title}`}>···</summary>
    <div className="conversation-action-menu"><button className="text-button" disabled={disabled} onClick={() => { if (root.current) root.current.open = false; onDelete(); }}>Delete conversation</button></div>
  </details>;
}
