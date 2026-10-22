// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiveTurn } from './live-transcript';
import type { SaveStatus, VoiceState } from './voice-session';
import { App } from './App';

const events = vi.hoisted(() => ({
  voice: (_state: VoiceState) => {},
  save: (_state: SaveStatus) => {},
  transcript: (_turns: LiveTurn[]) => {},
}));
vi.mock('./voice-session', async importOriginal => {
  const actual = await importOriginal<typeof import('./voice-session')>();
  return { ...actual, VoiceSession: class {
    constructor(_audio: HTMLAudioElement, voice: typeof events.voice, _platform: unknown, save: typeof events.save, transcript: typeof events.transcript) {
      events.voice = voice; events.save = save; events.transcript = transcript;
    }
    start() {
      events.transcript([]);
      events.voice({ status: 'connected', muted: false, message: 'Connected.' });
    }
    end() { events.voice({ status: 'ended', muted: false, message: 'Session ended.' }); }
    dispose() {}
  } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function begin() {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ realtimeConfigured: true, sessionMaxSeconds: 2700 })));
  render(<App />);
  const start = screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  act(() => events.transcript([{ itemId: 'u', speaker: 'user', text: 'Synthetic live speech.', status: 'draft' }, { itemId: 'a', speaker: 'assistant', text: 'Synthetic response.', status: 'draft' }]));
  expect(screen.getByText('Live transcript')).toBeTruthy();
}

it('removes live captions on End, while saving and archive access remain visible', async () => {
  await begin();
  act(() => events.save({ state: 'finalizing', conversationId: 'saved' }));
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  expect(screen.queryByText('Live transcript')).toBeNull();
  expect(screen.queryByText('Synthetic live speech.')).toBeNull();
  expect(screen.queryByText('Synthetic response.')).toBeNull();
  expect(screen.getByText(/Finishing final transcript/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Saved conversations +' })).toBeTruthy();
  // A late callback must not resurrect a closed call's live panel.
  act(() => {
    events.transcript([{ itemId: 'u', speaker: 'user', text: 'Late final text.', status: 'final' }]);
    events.save({ state: 'saved', conversationId: 'saved' });
  });
  expect(screen.queryByText('Late final text.')).toBeNull();
  expect(screen.getByText('Received turns saved')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  expect(screen.queryByText('Live transcript')).toBeNull();
  act(() => events.transcript([{ itemId: 'next', speaker: 'user', text: 'New call speech.', status: 'final' }]));
  expect(screen.getByText('New call speech.')).toBeTruthy();
});

it.each(['error', 'ended'] as const)('hides captions after a controller %s, including late callbacks', async status => {
  await begin();
  act(() => events.voice({ status, muted: false, message: 'Microphone is off.' }));
  expect(screen.queryByText('Live transcript')).toBeNull();
  act(() => events.transcript([{ itemId: 'u', speaker: 'user', text: 'Stale caption.', status: 'unconfirmed' }]));
  expect(screen.queryByText('Stale caption.')).toBeNull();
});
