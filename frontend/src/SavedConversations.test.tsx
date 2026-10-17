// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SavedConversations } from './SavedConversations';

const item = { id: 'synthetic-a', startedAt: 1, endedAt: 2, incomplete: 0, revision: 1, turnCount: 1, issues: [], title: 'Synthetic conversation', summaryStatus: 'ready' };
const detail = (text: string) => ({ ...item, summary: { sourceRevision: 1, status: 'ready', value: { sourceRevision: 1, points: [] } }, turns: [{ itemId: 'u', previousItemId: null, orderKnown: true, speaker: 'user', text, status: 'completed', revision: 1, createdAt: 1 }] });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('ignores an older detail response when active-session refresh supersedes it', async () => {
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { release = resolve; });
  let details = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/categories') return Response.json([]);
    if (url === '/api/conversations') return Response.json([item]);
    if (url === '/api/conversations/synthetic-a') return ++details === 1 ? delayed : Response.json(detail('CURRENT_TEXT'));
    throw new Error('Unexpected request');
  }));
  const view = render(<SavedConversations active={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved conversations +' }));
  fireEvent.click(await screen.findByRole('button', { name: item.title }));
  view.rerender(<SavedConversations active={true} />);
  await screen.findByText('CURRENT_TEXT');
  await act(async () => { release(Response.json(detail('STALE_TEXT'))); });
  expect(screen.queryByText('STALE_TEXT')).toBeNull();
  expect(screen.getByText('CURRENT_TEXT')).toBeTruthy();
});

it('polls an ended untitled conversation whose summary job has not appeared yet', async () => {
  vi.useFakeTimers();
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/categories') return Response.json([]);
    reads++;
    return Response.json([{ ...item, title: reads === 1 ? null : 'Prepared title', previewText: 'Opening excerpt', summaryStatus: reads === 1 ? null : 'ready' }]);
  }));
  render(<SavedConversations active={false} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Saved conversations +' })); });
  expect(screen.getByText('Opening excerpt')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText('Prepared title')).toBeTruthy();
});

it('requires confirmation and refreshes the list after deletion', async () => {
  let removed = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/categories') return Response.json([]);
    if (init?.method === 'DELETE') { removed = true; return Response.json({ ok: true }); }
    return Response.json(removed ? [] : [item]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SavedConversations active={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved conversations +' }));
  await screen.findByText(item.title);
  fireEvent.click(screen.getByRole('button', { name: /Delete conversation from/ }));
  expect(removed).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(removed).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /Delete conversation from/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByText('No saved conversations yet.');
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
});

it('refreshes grouped history after changing a conversation category', async () => {
  let categoryId: string | null = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/categories') return Response.json([{ id: 'work', name: 'Work' }]);
    if (init?.method === 'PATCH') { categoryId = JSON.parse(String(init.body)).categoryId; return Response.json({ ok: true }); }
    return Response.json([{ ...item, categoryId }]);
  }));
  render(<SavedConversations active={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved conversations +' }));
  await screen.findByText(item.title);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'work' } });
  const group = await screen.findByRole('region', { name: 'Work' });
  await waitFor(() => expect(group.textContent).toContain(item.title));
});
