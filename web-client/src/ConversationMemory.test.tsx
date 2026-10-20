// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { VoiceSession } from './voice-session';
const token = 'c'.repeat(64);
const sources = ['one', 'two', 'three', 'four'].map((id, n) => ({ id, categoryId: 'bq', title: `Conversation ${n + 1}`, startedAt: 100000 + n, endedAt: 200000, turnCount: 2, summaryStatus: 'ready' }));
function packet(ids = ['one']) { return { token, expiresAt: Date.now() + 60000, text: 'quoted summary', summariesOnly: true, sessions: ids.map(id => ({ id, revision: 1, startedAt: 100000 })), warnings: [], sections: ids.map(() => ({ startedAt: 100000, points: [{ kind: 'decision', text: 'Use a bounded queue.', sourceTurnIds: ['u'] }], recentTurns: [] })) }; }
function setup(extra: object[] = []) {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => url === '/api/health'
    ? Response.json({ realtimeConfigured: true, sessionMaxSeconds: 2700 })
    : url === '/api/categories' ? Response.json([{ id: 'bq', name: 'BQ' }])
    : url === '/api/conversations' ? Response.json([...sources, ...extra])
    : url === '/api/context/preview' ? Response.json(packet(JSON.parse(String(init?.body)).ids))
    : Response.json({ status: 'queued' }, { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  const start = vi.spyOn(VoiceSession.prototype, 'start').mockResolvedValue(undefined);
  render(<App />);
  return { fetchMock, start };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const startButton = () => screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement;
const checkbox = (n: number) => screen.getByRole('checkbox', { name: `Load Conversation ${n} into next conversation` }) as HTMLInputElement;
async function openHistory() { fireEvent.click(screen.getByRole('button', { name: 'Saved conversations +' })); await screen.findByRole('button', { name: 'Conversation 1' }); }

it('has one entry for browsing and memory, and automatically loads only the checked summaries', async () => {
  const s = setup(); await waitFor(() => expect(startButton().disabled).toBe(false));
  expect(screen.queryByText(/Memory for this conversation/)).toBeNull();
  fireEvent.click(startButton()); expect(s.start).toHaveBeenLastCalledWith(true, undefined, [], 'laptop');
  await openHistory(); fireEvent.click(checkbox(1));
  expect(startButton().disabled).toBe(false);
  await waitFor(() => expect(s.fetchMock.mock.calls.some(([url]) => url === '/api/context/preview')).toBe(true));
  await screen.findByText(/selected for next conversation.*ready/);
  expect(s.fetchMock).toHaveBeenCalledWith('/api/context/preview', expect.objectContaining({ body: JSON.stringify({ ids: ['one'], summariesOnly: true }) }));
  expect(screen.queryByRole('button', { name: 'Load selected summaries' })).toBeNull();
  fireEvent.click(startButton()); expect(s.start).toHaveBeenLastCalledWith(true, token, [], 'laptop');
  expect(startButton().disabled).toBe(false);
});

it('bulk selects a complete category beyond three conversations and can unselect it', async () => {
  const s = setup(); await openHistory();
  fireEvent.click(screen.getByRole('button', { name: 'Select all ready in BQ' }));
  for (let n = 1; n <= 4; n++) expect(checkbox(n).checked).toBe(true);
  await waitFor(() => expect(s.fetchMock.mock.calls.some(([url]) => url === '/api/context/preview')).toBe(true));
  await screen.findByText(/selected for next conversation.*ready/);
  expect(s.fetchMock).toHaveBeenCalledWith('/api/context/preview', expect.objectContaining({ body: JSON.stringify({ ids: sources.map(source => source.id), summariesOnly: true }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear all in BQ' }));
  for (let n = 1; n <= 4; n++) expect(checkbox(n).checked).toBe(false);
  expect(startButton().disabled).toBe(false);
});

it('keeps individual selections editable after bulk selection and supports Clear selection', async () => {
  setup(); await openHistory();
  fireEvent.click(screen.getByRole('button', { name: 'Select all ready in BQ' }));
  fireEvent.click(checkbox(2)); expect(checkbox(2).checked).toBe(false); expect(checkbox(1).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(startButton().disabled).toBe(false);
});

it('bulk selects ready summaries in a mixed category and explains excluded rows without paid generation', async () => {
  const s = setup([{ id: 'failed', categoryId: 'bq', title: 'Unavailable conversation', endedAt: 200000, startedAt: 100000, turnCount: 2, summaryStatus: 'failed' }]);
  await openHistory();
  expect((screen.getByRole('button', { name: 'Select all ready in BQ' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('Summary unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Select all ready in BQ' }));
  for (let n = 1; n <= 4; n++) expect(checkbox(n).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: 'Load Unavailable conversation into next conversation' }) as HTMLInputElement).checked).toBe(false);
  expect(s.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/summary'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare summary (API usage)' }));
  await waitFor(() => expect(s.fetchMock).toHaveBeenCalledWith('/api/conversations/failed/summary', expect.objectContaining({ method: 'POST' })));
});

it('keeps Start visually stable on memory failure and delegates selection validation to setup', async () => {
  const s = setup(); await openHistory();
  s.fetchMock.mockImplementation(async () => Response.json({ error: 'Selected summaries exceed the memory budget.' }, { status: 409 }));
  fireEvent.click(checkbox(1));
  await screen.findByText(/Selected summaries exceed/);
  expect(startButton().disabled).toBe(false);
  fireEvent.click(checkbox(1)); expect(startButton().disabled).toBe(false);
});

it('ignores an old preview after selection is cleared', async () => {
  const s = setup(); await openHistory();
  let release!: (response: Response) => void;
  s.fetchMock.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(checkbox(1)); await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(checkbox(1));
  release(Response.json(packet()));
  await waitFor(() => expect(startButton().disabled).toBe(false));
  expect(screen.getByText('Selected insights')).toBeTruthy();
  expect(screen.queryByText('Use a bounded queue.')).toBeNull();
});

it('expires the preview without changing Start appearance or dropping the selection', async () => {
  const s = setup(); await openHistory();
  s.fetchMock.mockImplementation(async () => Response.json({ ...packet(), expiresAt: Date.now() + 20 }));
  fireEvent.click(checkbox(1));
  await screen.findByText(/Selected summaries expired/);
  expect(startButton().disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(startButton().disabled).toBe(false);
});

it('keeps selection controls mounted and does not refetch the archive when Use changes', async () => {
  const s = setup(); await openHistory();
  const row = checkbox(1);
  const insights = screen.getByText('Selected insights');
  const clear = screen.getByRole('button', { name: 'Clear selection' });
  const reads = () => s.fetchMock.mock.calls.filter(([url]) => url === '/api/conversations').length;
  const before = reads();
  fireEvent.click(row);
  expect(screen.getByText('Selected insights')).toBe(insights);
  expect(screen.getByRole('button', { name: 'Clear selection' })).toBe(clear);
  await waitFor(() => expect(startButton().disabled).toBe(false));
  expect(checkbox(1)).toBe(row);
  expect(reads()).toBe(before);
  fireEvent.click(row);
  expect(screen.getByText('Selected insights')).toBe(insights);
  expect(screen.getByRole('button', { name: 'Clear selection' })).toBe(clear);
});

it('keeps the same enabled Start button while the first Use selection is loading', async () => {
  const s = setup(); await openHistory();
  const button = startButton();
  fireEvent.click(checkbox(1));
  expect(startButton()).toBe(button);
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(s.start).toHaveBeenLastCalledWith(true, undefined, ['one'], 'laptop');
});

it('labels the selection column once and does not repeat categories or Use text on every row', async () => {
  setup(); await openHistory();
  expect(screen.getAllByText('Load into next conversation')).toHaveLength(1);
  expect(screen.queryByText('Use', { exact: true })).toBeNull();
  expect(screen.queryAllByRole('combobox', { name: /^Category for/ })).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Select all ready in BQ' }).textContent).toBe('Select all');
});

it('selects the ready uncategorized conversation even when an empty conversation is present', async () => {
  setup([
    { id: 'empty', title: 'Empty conversation', categoryId: null, endedAt: 200000, startedAt: 100000, turnCount: 0, summaryStatus: null },
    { id: 'ready', title: 'Ready uncategorized', categoryId: null, endedAt: 200000, startedAt: 100000, turnCount: 2, summaryStatus: 'ready' },
  ]);
  await openHistory();
  expect(screen.getByText('No saved turns')).toBeTruthy();
  const empty = screen.getByRole('checkbox', { name: 'Load Empty conversation into next conversation' }) as HTMLInputElement;
  expect(empty.disabled).toBe(true);
  expect(document.getElementById(empty.getAttribute('aria-describedby')!)?.textContent).toBe('No saved turns');
  fireEvent.click(screen.getByRole('button', { name: 'Select all ready in Uncategorized' }));
  expect((screen.getByRole('checkbox', { name: 'Load Ready uncategorized into next conversation' }) as HTMLInputElement).checked).toBe(true);
  expect(empty.checked).toBe(false);
});

it('hides empty category sections while retaining their management in Category', async () => {
  const s = setup();
  s.fetchMock.mockImplementation(async (url) => url === '/api/categories' ? Response.json([{ id: 'bq', name: 'BQ' }, { id: 'empty-category', name: 'System Design' }]) : url === '/api/conversations' ? Response.json(sources) : Response.json({ realtimeConfigured: true, sessionMaxSeconds: 2700 }));
  await openHistory();
  expect(screen.queryByRole('region', { name: 'System Design' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '+ Category' }));
  expect(screen.getByText('Empty categories')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Category options for System Design' })).toBeTruthy();
});

it.each(['wrong source', 'raw transcript', 'expired'])('rejects a %s background preview before it can be used for Start', async kind => {
  const s = setup(); await openHistory();
  const value = packet();
  if (kind === 'wrong source') value.sessions[0].id = 'unselected';
  if (kind === 'raw transcript') Object.assign(value.sections[0], { recentTurns: [{ text: 'Do not load this' }] });
  if (kind === 'expired') value.expiresAt = Date.now() - 1;
  s.fetchMock.mockResolvedValue(Response.json(value));
  fireEvent.click(checkbox(1));
  await screen.findByText(/Selected summaries are not ready/);
  fireEvent.click(startButton());
  expect(s.start).toHaveBeenLastCalledWith(true, undefined, ['one'], 'laptop');
});

it('keeps empty-category management accessible at the 50-category limit', async () => {
  const s = setup();
  s.fetchMock.mockImplementation(async url => url === '/api/categories' ? Response.json(Array.from({ length: 50 }, (_, n) => ({ id: `category-${n}`, name: `Category ${n}` }))) : url === '/api/conversations' ? Response.json(sources) : Response.json({ realtimeConfigured: true, sessionMaxSeconds: 2700 }));
  await openHistory();
  const manager = screen.getByRole('button', { name: '+ Category' }) as HTMLButtonElement;
  expect(manager.disabled).toBe(false); fireEvent.click(manager);
  fireEvent.change(screen.getByRole('textbox', { name: 'Category name' }), { target: { value: 'New' } });
  expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Category options for Category 0' })).toBeTruthy();
});

it('explains an unavailable memory checkbox inside the transcript detail view', async () => {
  const s = setup(); await openHistory();
  s.fetchMock.mockImplementation(async url => Response.json(url === '/api/categories' ? [{ id: 'bq', name: 'BQ' }] : { ...sources[0], summaryStatus: 'failed', revision: 1, turns: [] }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversation 1' }));
  await screen.findByText('Summary unavailable');
  const input = checkbox(1);
  expect(input.disabled).toBe(true);
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Summary unavailable');
});

it('uses the headset filter for the next call without losing selected memory', async () => {
  const s = setup(); await openHistory();
  fireEvent.change(screen.getByRole('combobox', { name: 'Microphone noise filter' }), { target: { value: 'headset' } });
  fireEvent.click(checkbox(1));
  fireEvent.click(startButton());
  expect(s.start).toHaveBeenLastCalledWith(true, undefined, ['one'], 'headset');
  fireEvent.change(screen.getByRole('combobox', { name: 'Microphone noise filter' }), { target: { value: 'laptop' } });
  fireEvent.click(startButton());
  expect(s.start).toHaveBeenLastCalledWith(true, undefined, ['one'], 'laptop');
});
