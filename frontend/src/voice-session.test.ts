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

  it('ends automatically at a configured short session limit', async () => {
    vi.useFakeTimers();
    const s = scenario();
    await s.session.start(); s.connected();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.states.at(-1)?.status).toBe('ended');
    expect(s.states.at(-1)?.message).toContain('time limit');
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('accepts 45 minutes, remains connected past two minutes, and cleans up at expiry', async () => {
    vi.useFakeTimers();
    const s = scenario();
    s.fetchMock.mockResolvedValueOnce(Response.json({ value: 'ek_test', sessionMaxSeconds: 2700 }));
    await s.session.start(); s.connected();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.states.at(-1)?.status).toBe('connected');
    expect(s.track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_579_999);
    expect(s.states.at(-1)?.status).toBe('connected');
    await vi.advanceTimersByTimeAsync(1);
    expect(s.states.at(-1)?.status).toBe('ended');
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.peer.close).toHaveBeenCalledOnce();
    expect(s.channel.close).toHaveBeenCalledOnce();
    expect(s.audio.pause).toHaveBeenCalledOnce();
  });

  it.each([29, 2701])('rejects an out-of-range session limit of %s seconds', async sessionMaxSeconds => {
    const s = scenario();
    s.fetchMock.mockResolvedValueOnce(Response.json({ value: 'ek_test', sessionMaxSeconds }));
    await s.session.start();
    expect(s.states.at(-1)?.status).toBe('error');
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.peer.createDataChannel).not.toHaveBeenCalled();
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


  it('keeps voice connected when background saving status fails and ends media without waiting for saves', async () => {
    vi.useFakeTimers();
    const s = scenario();
    const statuses: { state: string }[] = [];
    const voiceStates: VoiceState[] = [];
    const saved = new VoiceSession(s.audio as unknown as HTMLAudioElement, state => voiceStates.push(state), s.platform, state => statuses.push(state));
    active.push(saved);
    const handle = 'a'.repeat(64);
    s.fetchMock.mockImplementation(async url => {
      if (url === '/api/session') return Response.json({ handle, conversationId: 'conversation-test', sessionMaxSeconds: 2700 });
      if (url === '/api/call') return new Response('saved-answer');
      if (url === '/api/capture/status') throw new Error('storage network unavailable');
      return new Promise(() => {});
    });
    await saved.start(true); s.connected();
    expect(voiceStates.at(-1)?.status).toBe('connected');
    expect(JSON.parse(String(s.fetchMock.mock.calls[0][1]?.body))).toEqual({ save: true });
    expect(s.fetchMock.mock.calls[1][0]).toBe('/api/call');
    expect(s.peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'saved-answer' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.at(-1)?.state).toBe('delayed');
    expect(voiceStates.at(-1)?.status).toBe('connected');
    expect(s.track.stop).not.toHaveBeenCalled();
    s.channel.onmessage?.({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) });
    saved.end();
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.audio.pause).toHaveBeenCalledOnce();
    expect(s.peer.close).not.toHaveBeenCalled();
    expect(s.fetchMock).toHaveBeenCalledWith('/api/capture/end', expect.objectContaining({ keepalive: true }));
    expect(voiceStates.at(-1)?.status).toBe('ended');
    expect(statuses.at(-1)?.state).toBe('finalizing');
    await vi.advanceTimersByTimeAsync(200);
    expect(s.channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'input_audio_buffer.commit', event_id: 'voxa_end_commit' }));
    await vi.advanceTimersByTimeAsync(14_800);
    expect(s.peer.close).toHaveBeenCalledOnce();
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('does not publish late saving status after disposal', async () => {
    vi.useFakeTimers();
    const s = scenario();
    const statuses: { state: string }[] = [];
    const pending = deferred<Response>();
    const saved = new VoiceSession(s.audio as unknown as HTMLAudioElement, () => {}, s.platform, state => statuses.push(state));
    active.push(saved);
    s.fetchMock.mockImplementation(async url => {
      if (url === '/api/session') return Response.json({ handle: 'a'.repeat(64), conversationId: 'conversation-test', sessionMaxSeconds: 2700 });
      if (url === '/api/capture/status') return pending.promise;
      return new Response('answer');
    });
    await saved.start(true); s.connected();
    await vi.advanceTimersByTimeAsync(1000);
    saved.dispose(); const count = statuses.length;
    pending.resolve(Response.json({ state: 'saved', pending: 0, ended: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses).toHaveLength(count);
  });

  it('closing an ended session after its drain never stops a newly started session', async () => {
    vi.useFakeTimers();
    const old = setup(), next = setup();
    const platform: VoicePlatform = {
      getUserMedia: vi.fn().mockResolvedValueOnce(old.stream).mockResolvedValueOnce(next.stream),
      createPeerConnection: vi.fn().mockReturnValueOnce(old.peer).mockReturnValueOnce(next.peer),
      fetch: vi.fn(async url => url === '/api/session'
        ? Response.json({ handle: 'a'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700 })
        : url === '/api/capture/status' ? Response.json({ state: 'saved', ended: true, pending: 0 }) : new Response('answer')),
    };
    const session = new VoiceSession(old.audio as unknown as HTMLAudioElement, () => {}, platform);
    active.push(session);
    await session.start(true); old.connected(); session.end();
    await session.start(true); next.connected();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(old.track.stop).toHaveBeenCalledOnce();
    expect(old.peer.close).toHaveBeenCalledOnce();
    expect(next.track.stop).not.toHaveBeenCalled();
    expect(next.peer.close).not.toHaveBeenCalled();
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

it('ignores harmless idle cancellation but still stops on unexpected provider errors', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'error', error: { code: 'response_cancel_not_active' } }) });
  expect(s.states.at(-1)?.status).toBe('connected'); expect(s.track.stop).not.toHaveBeenCalled();
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'error', error: { code: 'unexpected_error' } }) });
  expect(s.states.at(-1)?.status).toBe('error'); expect(s.track.stop).toHaveBeenCalledOnce();
});

it('loads selected context once and keeps the microphone muted until its acknowledgment', async () => {
  const s = scenario(); const itemId = `voxa_context_${'a'.repeat(24)}`;
  s.fetchMock.mockImplementation(async url => url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700, context: { itemId, text: 'Synthetic selected context: Orchard.' } }) : new Response('answer'));
  await s.session.start(true, 'c'.repeat(64)); s.connected();
  expect(s.track.enabled).toBe(false); expect(s.states.at(-1)?.status).toBe('connecting');
  const sent = JSON.parse(s.channel.send.mock.calls[0][0]); expect(sent.type).toBe('conversation.item.create'); expect(sent.item.role).toBe('user'); expect(sent.item.content[0].text).toContain('Orchard');
  s.channel.onopen?.(); expect(s.channel.send).toHaveBeenCalledOnce();
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.done', item: { id: 'unrelated' } }) }); expect(s.track.enabled).toBe(false);
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.done', item: { id: itemId } }) });
  expect(s.track.enabled).toBe(true); expect(s.states.at(-1)?.status).toBe('connected');
  expect(s.channel.send.mock.calls.some(call => JSON.parse(call[0]).type === 'response.create')).toBe(false);
});
it('cleans up when selected context is missing, rejected or never acknowledged', async () => {
  vi.useFakeTimers();
  const s = scenario();
  s.fetchMock.mockImplementation(async url => url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700, context: { itemId: `voxa_context_${'a'.repeat(24)}`, text: 'Synthetic context' } }) : new Response('answer'));
  await s.session.start(true, 'c'.repeat(64)); s.connected(); await vi.advanceTimersByTimeAsync(30_000);
  expect(s.track.stop).toHaveBeenCalledOnce(); expect(s.states.at(-1)?.status).toBe('error'); expect(s.peer.close).toHaveBeenCalledOnce();
  const missing = scenario(); await missing.session.start(true, 'a'.repeat(64)); expect(missing.track.stop).toHaveBeenCalledOnce(); expect(missing.states.at(-1)?.message).toContain('Saved history');
});

it('ends the registered capture if setup returns invalid selected context', async () => {
  const s = scenario();
  s.fetchMock.mockImplementation(async url => url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700 }) : new Response('answer'));
  await s.session.start(true, 'c'.repeat(64));
  expect(s.track.stop).toHaveBeenCalledOnce(); expect(s.states.at(-1)?.message).toContain('Saved history');
  expect(s.fetchMock).toHaveBeenCalledWith('/api/capture/end', expect.objectContaining({ body: JSON.stringify({ handle: 'b'.repeat(64) }), keepalive: true }));
});

it('automatically loads history without a selection token and releases an unsaved session immediately', async () => {
  const s=scenario(); const itemId=`voxa_context_${'a'.repeat(24)}`;
  s.fetchMock.mockImplementation(async url=>url==='/api/session'?Response.json({handle:'b'.repeat(64),conversationId:'c',sessionMaxSeconds:2700,context:{itemId,text:'Synthetic automatic context'}}):new Response('answer'));
  await s.session.start(false); expect(s.track.enabled).toBe(false); s.connected(); expect(s.states.at(-1)?.status).toBe('connecting');
  s.channel.onmessage?.({data:JSON.stringify({type:'conversation.item.done',item:{id:itemId}})});
  expect(s.track.enabled).toBe(true); expect(s.states.at(-1)?.status).toBe('connected');
  expect(JSON.parse(String(s.fetchMock.mock.calls[0][1]?.body))).toEqual({save:false});
  s.session.end(); expect(s.peer.close).toHaveBeenCalledOnce(); expect(s.fetchMock).toHaveBeenCalledWith('/api/capture/end',expect.anything());
});

it('releases the microphone when automatic history is unavailable', async () => {
  const s=scenario(); s.fetchMock.mockResolvedValue(Response.json({code:'HISTORY_UNAVAILABLE'},{status:409}));
  await s.session.start(true); expect(s.track.stop).toHaveBeenCalledOnce(); expect(s.peer.createDataChannel).not.toHaveBeenCalled();
  expect(s.states.at(-1)?.message).toContain('Saved history is unavailable'); expect(s.states.at(-1)?.status).toBe('error');
});
