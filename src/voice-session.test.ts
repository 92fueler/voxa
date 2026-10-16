import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSession, type VoicePlatform, type VoiceState } from './voice-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const track = { enabled: true, stop: vi.fn(), onended: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const channel = {
    readyState: 'connecting', onopen: null as null | (() => void), onclose: null as null | (() => void), onerror: null,
    onmessage: null as null | ((event: { data: string }) => void), send: vi.fn(), close: vi.fn(),
  };
  const peer = {
    connectionState: 'new', onconnectionstatechange: null as null | (() => void), ontrack: null,
    createDataChannel: vi.fn(() => channel), addTrack: vi.fn(), close: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'test-offer' })),
    setLocalDescription: vi.fn(async () => {}), setRemoteDescription: vi.fn(async () => {}),
  };
  const audio = { srcObject: null, pause: vi.fn(), play: vi.fn(async () => {}) };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => url === '/api/session'
    ? Response.json({ value: 'ek_test', sessionMaxSeconds: 30 })
    : new Response('test-answer'));
  const platform: VoicePlatform = {
    fetch: fetchMock,
    getUserMedia: vi.fn(async () => stream),
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
  };
  const states: VoiceState[] = [];
  const session = new VoiceSession(audio as unknown as HTMLAudioElement, state => states.push(state), platform);
  const connected = () => { peer.connectionState = 'connected'; channel.readyState = 'open'; channel.onopen?.(); peer.onconnectionstatechange?.(); };
  return { session, states, platform, fetchMock, track, stream, peer, channel, audio, connected };
}

const active: VoiceSession[] = [];
afterEach(() => { active.splice(0).forEach(session => session.dispose()); vi.useRealTimers(); });
function scenario() { const result = setup(); active.push(result.session); return result; }

describe('voice lifecycle with mocked media and provider', () => {
  it('exchanges SDP with the temporary key and becomes ready only when connected', async () => {
    const s = scenario();
    await s.session.start();
    expect(s.states.at(-1)?.status).toBe('connecting');
    expect(s.peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'test-answer' });
    expect(s.fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer ek_test' });
    s.connected();
    expect(s.states.at(-1)?.status).toBe('connected');
    s.session.end();
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.peer.close).toHaveBeenCalledOnce();
    expect(s.channel.close).toHaveBeenCalledOnce();
    expect(s.audio.pause).toHaveBeenCalledOnce();
    expect(s.audio.srcObject).toBeNull();
  });

  it('prevents duplicate Start calls', async () => {
    const s = scenario();
    await Promise.all([s.session.start(), s.session.start()]);
    expect(s.platform.getUserMedia).toHaveBeenCalledOnce();
    expect(s.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops a late microphone result after End without creating credentials', async () => {
    const s = scenario();
    const pending = deferred<MediaStream>();
    s.platform.getUserMedia = () => pending.promise;
    const starting = s.session.start();
    s.session.end();
    pending.resolve(s.stream);
    await starting;
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.fetchMock).not.toHaveBeenCalled();
    expect(s.states.at(-1)?.status).toBe('ended');
  });

  it('does not revive an ended session after a late credential response', async () => {
    const s = scenario();
    const pending = deferred<Response>();
    s.fetchMock.mockImplementation(() => pending.promise);
    const starting = s.session.start();
    await vi.waitFor(() => expect(s.fetchMock).toHaveBeenCalledOnce());
    s.session.end();
    pending.resolve(Response.json({ value: 'ek_test', sessionMaxSeconds: 30 }));
    await starting;
    expect(s.peer.createDataChannel).not.toHaveBeenCalled();
    expect(s.states.at(-1)?.status).toBe('ended');
  });

  it('supports a fresh attempt while an older permission request is still pending', async () => {
    const s = scenario();
    const pending = deferred<MediaStream>();
    s.platform.getUserMedia = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(s.stream);
    const oldStart = s.session.start();
    s.session.end();
    await s.session.start();
    s.connected();
    const oldTrack = { stop: vi.fn() };
    pending.resolve({ getTracks: () => [oldTrack] } as unknown as MediaStream);
    await oldStart;
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(s.track.stop).not.toHaveBeenCalled();
    expect(s.states.at(-1)?.status).toBe('connected');
  });

  it('reports permission denial without a provider call', async () => {
    const s = scenario();
    s.platform.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    await s.session.start();
    expect(s.states.at(-1)?.message).toContain('denied');
    expect(s.fetchMock).not.toHaveBeenCalled();
  });

  it('releases the microphone on a credential failure', async () => {
    const s = scenario();
    s.fetchMock.mockResolvedValue(Response.json({ code: 'API_KEY_REQUIRED' }, { status: 503 }));
    await s.session.start();
    expect(s.states.at(-1)?.message).toContain('server API key');
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('cleans up on provider call rejection', async () => {
    const s = scenario();
    s.fetchMock.mockResolvedValueOnce(Response.json({ value: 'ek_test', sessionMaxSeconds: 30 })).mockResolvedValueOnce(new Response('private provider details', { status: 500 }));
    await s.session.start();
    expect(s.states.at(-1)?.status).toBe('error');
    expect(s.states.at(-1)?.message).not.toContain('private provider');
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.peer.close).toHaveBeenCalledOnce();
  });

  it('mutes input without ending the session or losing mute state to duplicate ready events', async () => {
    const s = scenario();
    await s.session.start(); s.connected();
    s.session.toggleMute(); s.connected();
    expect(s.track.enabled).toBe(false);
    expect(s.states.at(-1)?.muted).toBe(true);
    expect(s.peer.close).not.toHaveBeenCalled();
    s.session.toggleMute();
    expect(s.track.enabled).toBe(true);
  });

  it('stops resources on disconnection and can start again', async () => {
    const s = scenario();
    await s.session.start(); s.connected();
    s.peer.connectionState = 'disconnected'; s.peer.onconnectionstatechange?.();
    expect(s.states.at(-1)?.status).toBe('error');
    expect(s.track.stop).toHaveBeenCalledOnce();
    await s.session.start();
    expect(s.platform.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('ends automatically at the short trial limit', async () => {
    vi.useFakeTimers();
    const s = scenario();
    await s.session.start(); s.connected();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.states.at(-1)?.status).toBe('ended');
    expect(s.states.at(-1)?.message).toContain('time limit');
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('times out a stuck permission request and disposes its late stream', async () => {
    vi.useFakeTimers();
    const s = scenario();
    const pending = deferred<MediaStream>();
    s.platform.getUserMedia = () => pending.promise;
    const starting = s.session.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.states.at(-1)?.status).toBe('error');
    pending.resolve(s.stream); await starting;
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.fetchMock).not.toHaveBeenCalled();
  });

  it('disposes on unmount without publishing another UI state', async () => {
    const s = scenario();
    await s.session.start(); s.connected();
    const count = s.states.length;
    s.session.dispose();
    expect(s.states).toHaveLength(count);
    expect(s.track.stop).toHaveBeenCalledOnce();
  });
});
