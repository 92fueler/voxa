// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('does not let an obsolete health response disable a healthy remounted app', async () => {
  let release!: (response: Response) => void;
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn((url) => url === '/api/conversations' ? Promise.resolve(Response.json([])) : ++reads === 1 ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(Response.json({ realtimeConfigured: true, model: 'synthetic', sessionMaxSeconds: 2700 }))));
  render(<StrictMode><App /></StrictMode>);
  const start = screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  await act(async () => { release(new Response('', { status: 503 })); });
  expect(start.disabled).toBe(false);
  expect(screen.queryByText('Connect to the backend to continue.')).toBeNull();
});
