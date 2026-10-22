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


it('shows an explicit hosted sign-in link on 401 and disables voice until authenticated', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 401 }))));
  render(<App />);
  const link = await screen.findByRole('link', { name: 'Sign in to hosted Voxa' });
  expect(link.getAttribute('href')).toBe('/api/health');
  expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(true);
});

it('describes backend storage rather than promising device-local hosted data', async () => {
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/health' ? Response.json({ realtimeConfigured: true, model: 'synthetic', sessionMaxSeconds: 2700 }) : Response.json([]))));
  render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText(/A hosted backend stores it on that server/)).toBeTruthy();
});
