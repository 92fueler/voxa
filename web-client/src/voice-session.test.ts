import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveTurn } from './live-transcript';
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
  const captions: LiveTurn[][] = [];
  const session = new VoiceSession(audio as unknown as HTMLAudioElement, state => states.push(state), platform, undefined, turns => captions.push(turns));
  const connected = () => { peer.connectionState = 'connected'; channel.readyState = 'open'; channel.onopen?.(); peer.onconnectionstatechange?.(); };
  return { session, states, platform, fetchMock, track, stream, peer, channel, audio, connected, captions };
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
  const s = scenario(); const itemId = `voxa_context_${'a'.repeat(18)}`;
  s.fetchMock.mockImplementation(async url => url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700, context: { itemId, text: 'Synthetic selected context: Orchard.' } }) : new Response('answer'));
  await s.session.start(true, 'c'.repeat(64)); s.connected();
  expect(s.track.enabled).toBe(false); expect(s.states.at(-1)?.status).toBe('connecting');
  const sent = JSON.parse(s.channel.send.mock.calls[0][0]); expect(sent.item.id.length).toBeLessThanOrEqual(32); expect(sent.type).toBe('conversation.item.create'); expect(sent.item.role).toBe('user'); expect(sent.item.content[0].text).toContain('Orchard');
  s.channel.onopen?.(); expect(s.channel.send).toHaveBeenCalledOnce();
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.done', item: { id: 'unrelated' } }) }); expect(s.track.enabled).toBe(false);
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.done', item: { id: itemId } }) });
  expect(s.track.enabled).toBe(true); expect(s.states.at(-1)?.status).toBe('connected');
  expect(s.channel.send.mock.calls.some(call => JSON.parse(call[0]).type === 'response.create')).toBe(false);
});
it('cleans up when selected context is missing, rejected or never acknowledged', async () => {
  vi.useFakeTimers();
  const s = scenario();
  s.fetchMock.mockImplementation(async url => url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700, context: { itemId: `voxa_context_${'a'.repeat(18)}`, text: 'Synthetic context' } }) : new Response('answer'));
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

it('loads explicitly selected history and releases an unsaved session immediately', async () => {
  const s=scenario(); const itemId=`voxa_context_${'a'.repeat(18)}`;
  s.fetchMock.mockImplementation(async url=>url==='/api/session'?Response.json({handle:'b'.repeat(64),conversationId:'c',sessionMaxSeconds:2700,context:{itemId,text:'Synthetic selected context'}}):new Response('answer'));
  await s.session.start(false, 'c'.repeat(64)); expect(s.track.enabled).toBe(false); s.connected(); expect(s.states.at(-1)?.status).toBe('connecting');
  s.channel.onmessage?.({data:JSON.stringify({type:'conversation.item.done',item:{id:itemId}})});
  expect(s.track.enabled).toBe(true); expect(s.states.at(-1)?.status).toBe('connected');
  expect(JSON.parse(String(s.fetchMock.mock.calls[0][1]?.body))).toEqual({save:false,contextToken:'c'.repeat(64)});
  s.session.end(); expect(s.peer.close).toHaveBeenCalledOnce(); expect(s.fetchMock).toHaveBeenCalledWith('/api/capture/end',expect.anything());
});

it('releases the microphone when selected history is unavailable', async () => {
  const s=scenario(); s.fetchMock.mockResolvedValue(Response.json({code:'HISTORY_UNAVAILABLE'},{status:409}));
  await s.session.start(true); expect(s.track.stop).toHaveBeenCalledOnce(); expect(s.peer.createDataChannel).not.toHaveBeenCalled();
  expect(s.states.at(-1)?.message).toContain('Saved history is unavailable'); expect(s.states.at(-1)?.status).toBe('error');
});

it('shows only a bounded provider error code, excluding message and payload data', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'error', error: { code: 'rate_limit_exceeded', message: 'private provider payload' } }) });
  expect(s.states.at(-1)?.message).toContain('(rate_limit_exceeded)');
  expect(s.states.at(-1)?.message).not.toContain('private provider payload');
  expect(s.track.stop).toHaveBeenCalledOnce();
  await s.session.start(); s.connected();
  s.channel.onmessage?.({ data: JSON.stringify({ type: 'error', error: { code: 'unsafe arbitrary text' } }) });
  expect(s.states.at(-1)?.message).toBe('The voice service reported an error. Your microphone is off. Try again.');
});

it('rejects an overlong history item ID before opening provider transport', async () => {
  const s = scenario();
  s.fetchMock.mockResolvedValue(Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700, context: { itemId: `voxa_context_${'a'.repeat(24)}`, text: 'Synthetic history' } }));
  await s.session.start(true, 'c'.repeat(64));
  expect(s.peer.createDataChannel).not.toHaveBeenCalled();
  expect(s.track.stop).toHaveBeenCalledOnce();
  expect(s.states.at(-1)?.message).toContain('Saved history could not be loaded');
});

function emit(s: ReturnType<typeof scenario>, event: object) {
  s.channel.onmessage?.({ data: JSON.stringify(event) });
}
function speech(s: ReturnType<typeof scenario>, text: string, id = 'user_1') {
  emit(s, { type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
}
function styleAck(s: ReturnType<typeof scenario>, eagerness: 'low' | 'medium') {
  emit(s, { type: 'session.updated', session: { audio: { input: { turn_detection: { eagerness } } } } });
}

it('switches pace between turns, waits for acknowledgment and preserves interruption settings', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  emit(s, { type: 'response.created' });
  emit(s, { type: 'output_audio_buffer.started' });
  speech(s, 'Mock interview me');
  expect(s.channel.send).not.toHaveBeenCalled();
  emit(s, { type: 'response.done' });
  expect(s.channel.send).not.toHaveBeenCalled();
  emit(s, { type: 'output_audio_buffer.stopped' });
  const request = JSON.parse(s.channel.send.mock.calls[0][0]);
  expect(request).toMatchObject({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: { type: 'semantic_vad', eagerness: 'low', create_response: true, interrupt_response: true } } } } });
  expect(s.states.at(-1)?.turnStyle).toBe('everyday');
  styleAck(s, 'low');
  expect(s.states.at(-1)?.turnStyle).toBe('thinking');
  speech(s, 'Mock interview me'); // Duplicate final event cannot change intent or send again.
  expect(s.channel.send).toHaveBeenCalledOnce();
  speech(s, "Let's just chat", 'user_2');
  expect(JSON.parse(s.channel.send.mock.calls[1][0]).session.audio.input.turn_detection.eagerness).toBe('medium');
  styleAck(s, 'medium');
  expect(s.states.at(-1)?.turnStyle).toBe('everyday');
  expect(s.track.stop).not.toHaveBeenCalled();
});

it('does not update pacing during user speech or from assistant or archive text', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  emit(s, { type: 'response.output_audio_transcript.done', item_id: 'assistant', transcript: 'Mock interview me' });
  emit(s, { type: 'conversation.item.done', item: { id: 'archive', role: 'user', content: [{ type: 'input_text', text: 'Mock interview me' }] } });
  expect(s.channel.send).not.toHaveBeenCalled();
  emit(s, { type: 'input_audio_buffer.speech_started' });
  speech(s, 'Give me more thinking time');
  expect(s.channel.send).not.toHaveBeenCalled();
  emit(s, { type: 'input_audio_buffer.speech_stopped' });
  expect(s.channel.send).toHaveBeenCalledOnce(); styleAck(s, 'low');
  speech(s, "Let's just chat", 'user_2');
  expect(s.channel.send).toHaveBeenCalledOnce();
  expect(s.states.at(-1)?.turnStyleLocked).toBe(true);
  speech(s, 'Use automatic turn-taking', 'user_3');
  speech(s, "Let's just chat", 'user_4');
  expect(s.channel.send).toHaveBeenCalledTimes(2);
});

it('keeps voice running if a pacing update is rejected or times out, and cleans up on End', async () => {
  vi.useFakeTimers();
  const s = scenario(); await s.session.start(); s.connected();
  speech(s, 'Give me more thinking time');
  emit(s, { type: 'error', error: { event_id: 'voxa_turn_style_1', code: 'invalid_request_error' } });
  expect(s.states.at(-1)?.status).toBe('connected');
  expect(s.states.at(-1)?.turnStyle).toBe('everyday');
  expect(s.states.at(-1)?.message).toContain('Conversation can continue');
  emit(s, { type: 'response.done' });
  expect(s.channel.send).toHaveBeenCalledOnce();
  speech(s, 'Give me more thinking time', 'user_2');
  await vi.advanceTimersByTimeAsync(5000);
  expect(s.states.at(-1)?.status).toBe('connected');
  expect(s.track.stop).not.toHaveBeenCalled();
  speech(s, 'Give me more thinking time', 'user_3');
  s.session.end();
  const count = s.channel.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(6000);
  expect(s.channel.send).toHaveBeenCalledTimes(count);
  expect(s.states.at(-1)?.status).toBe('ended');
});

it('reconciles a delayed pacing acknowledgment and starts fresh after End', async () => {
  vi.useFakeTimers();
  const s = scenario(); await s.session.start(); s.connected();
  speech(s, 'Give me more thinking time');
  await vi.advanceTimersByTimeAsync(5000);
  styleAck(s, 'low');
  expect(s.states.at(-1)?.turnStyle).toBe('thinking');
  expect(s.channel.send).toHaveBeenCalledOnce();
  s.session.end(); await s.session.start(); s.connected();
  expect(s.states.at(-1)?.turnStyle).toBe('everyday');
  expect(s.states.at(-1)?.turnStyleLocked).toBe(false);
});

it('keeps a newer intent queued while an older pacing change awaits acknowledgment', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  speech(s, 'Give me more thinking time');
  speech(s, 'Use normal conversation', 'user_2');
  expect(s.channel.send).toHaveBeenCalledOnce();
  styleAck(s, 'low');
  expect(s.channel.send).toHaveBeenCalledTimes(2);
  styleAck(s, 'medium');
  expect(s.states.at(-1)?.turnStyle).toBe('everyday');
  expect(s.states.at(-1)?.turnStyleLocked).toBe(true);
});

it('ignores a stale rejection from an earlier pacing request', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  speech(s, 'Give me more thinking time'); styleAck(s, 'low');
  speech(s, 'Use normal conversation', 'user_2');
  emit(s, { type: 'error', error: { event_id: 'voxa_turn_style_1', code: 'invalid_request_error' } });
  expect(s.states.at(-1)?.status).toBe('connected');
  styleAck(s, 'medium');
  expect(s.states.at(-1)?.turnStyle).toBe('everyday');
});

it('displays drafts without archive reads or pacing changes, then replaces them immediately with final text', async () => {
  vi.useFakeTimers();
  const s = scenario(); await s.session.start(); s.connected();
  const requests = s.fetchMock.mock.calls.length;
  emit(s, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: 'Give me more thinking time' });
  expect(s.channel.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(80);
  expect(s.captions.at(-1)?.[0]).toMatchObject({ text: 'Give me more thinking time', status: 'draft' });
  speech(s, '你好，cache 是缓存。', 'u');
  expect(s.captions.at(-1)?.[0]).toMatchObject({ text: '你好，cache 是缓存。', status: 'final' });
  expect(s.channel.send).not.toHaveBeenCalled();
  expect(s.fetchMock).toHaveBeenCalledTimes(requests);
});

it('marks unfinished captions unconfirmed on End, cancels buffered callbacks and resets on Start', async () => {
  vi.useFakeTimers();
  const s = scenario(); await s.session.start(); s.connected();
  const oldMessage = s.channel.onmessage;
  emit(s, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: 'draft' });
  s.session.end();
  expect(s.captions.at(-1)?.[0]).toMatchObject({ text: 'draft', status: 'unconfirmed' });
  await s.session.start(); s.connected();
  expect(s.captions.at(-1)).toEqual([]);
  oldMessage?.({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u', transcript: 'late old final' }) });
  await vi.advanceTimersByTimeAsync(80);
  expect(s.captions.at(-1)).toEqual([]);
});

it('does not gate voice on caption errors and never labels failed partials as final', async () => {
  const s = scenario(); await s.session.start(); s.connected();
  emit(s, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u', delta: 'unfinished' });
  emit(s, { type: 'conversation.item.input_audio_transcription.failed', item_id: 'u', error: { message: 'private' } });
  expect(s.captions.at(-1)?.[0]).toMatchObject({ text: 'unfinished', status: 'unconfirmed' });
  expect(s.states.at(-1)?.status).toBe('connected');
  expect(s.track.stop).not.toHaveBeenCalled();
});

it('loads selected summaries on Start before microphone access when background preview is not ready', async () => {
  const s = scenario(); const preview = deferred<Response>();
  s.fetchMock.mockImplementation(async url => url === '/api/context/preview' ? preview.promise : url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'saved', sessionMaxSeconds: 30, context: { itemId: `voxa_context_${'c'.repeat(18)}`, text: 'Synthetic selected insight' } }) : new Response('answer'));
  const starting = s.session.start(true, undefined, ['chosen']);
  expect(s.platform.getUserMedia).not.toHaveBeenCalled();
  expect(s.states.at(-1)?.message).toContain('Loading selected summaries');
  expect(s.fetchMock).toHaveBeenCalledWith('/api/context/preview', expect.objectContaining({ body: JSON.stringify({ ids: ['chosen'], summariesOnly: true }) }));
  preview.resolve(Response.json({ token: 'a'.repeat(64), text: 'Synthetic insight', expiresAt: Date.now() + 60000, warnings: [], summariesOnly: true, sessions: [{ id: 'chosen' }], sections: [{ points: [{ text: 'Synthetic insight' }], recentTurns: [] }] }));
  await starting;
  expect(s.platform.getUserMedia).toHaveBeenCalledOnce();
  expect(s.fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ body: JSON.stringify({ save: true, contextToken: 'a'.repeat(64) }) }));
});

it('never falls back to a memory-free session if selected-summary setup fails', async () => {
  const s = scenario(); s.fetchMock.mockResolvedValue(Response.json({ code: 'SUMMARY_PENDING' }, { status: 409 }));
  await s.session.start(true, undefined, ['chosen']);
  expect(s.platform.getUserMedia).not.toHaveBeenCalled();
  expect(s.fetchMock).toHaveBeenCalledOnce();
  expect(s.states.at(-1)?.status).toBe('error');
  expect(s.states.at(-1)?.message).toContain('Saved history could not be loaded');
});

it('cancels a summary-loading Start and ignores late preview results after End', async () => {
  const s = scenario(); const preview = deferred<Response>(); s.fetchMock.mockReturnValue(preview.promise);
  const starting = s.session.start(true, undefined, ['chosen']);
  s.session.end();
  preview.resolve(Response.json({ token: 'a'.repeat(64) })); await starting;
  expect(s.platform.getUserMedia).not.toHaveBeenCalled();
  expect(s.states.at(-1)?.status).toBe('ended');
});

it('rejects unsolicited history when nothing was selected and releases registered resources', async () => {
  const s = scenario();
  s.fetchMock.mockImplementation(async url => url === '/api/session' ? Response.json({ handle: 'b'.repeat(64), conversationId: 'c', sessionMaxSeconds: 2700, context: { itemId: `voxa_context_${'a'.repeat(18)}`, text: 'Unselected archive' } }) : new Response('ok'));
  await s.session.start(true);
  expect(s.peer.createDataChannel).not.toHaveBeenCalled();
  expect(s.track.stop).toHaveBeenCalledOnce();
  expect(s.states.at(-1)?.status).toBe('error');
  expect(s.fetchMock).toHaveBeenCalledWith('/api/capture/end', expect.anything());
});

it.each(['laptop', 'headset'] as const)('sends the chosen %s microphone profile when starting', async microphone => {
  const s = scenario();
  await s.session.start(false, undefined, [], microphone);
  expect(s.fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ body: JSON.stringify({ save: false, microphone }) }));
  s.connected();
  expect(s.states.at(-1)?.status).toBe('connected');
});

it('streams Voxa captions without changing pace, fetching transcripts or claiming interrupted output was heard', async () => {
  vi.useFakeTimers();
  const s = scenario(); await s.session.start(); s.connected();
  const reads = s.fetchMock.mock.calls.length;
  emit(s, { type: 'response.output_audio_transcript.delta', response_id: 'r', item_id: 'a', delta: 'Mock interview me' });
  await vi.advanceTimersByTimeAsync(80);
  expect(s.captions.at(-1)?.[0]).toMatchObject({ speaker: 'assistant', text: 'Mock interview me', status: 'draft' });
  emit(s, { type: 'response.output_audio_transcript.done', response_id: 'r', item_id: 'a', transcript: 'Give me more thinking time' });
  expect(s.captions.at(-1)?.[0]).toMatchObject({ speaker: 'assistant', text: 'Give me more thinking time', status: 'final' });
  expect(s.channel.send).not.toHaveBeenCalled();
  expect(s.fetchMock).toHaveBeenCalledTimes(reads);
  emit(s, { type: 'output_audio_buffer.cleared', response_id: 'r' });
  expect(s.captions.at(-1)?.[0].status).toBe('interrupted');
  expect(s.states.at(-1)?.status).toBe('connected');
  expect(s.track.stop).not.toHaveBeenCalled();
});


it.each([
  ['PROVIDER_TIMEOUT', undefined, 'timed out'],
  ['PROVIDER_AUTH_FAILED', 401, 'authentication'],
  ['PROVIDER_QUOTA_EXCEEDED', 429, 'quota'],
  ['PROVIDER_RATE_LIMITED', 429, 'rate limited'],
  ['PROVIDER_MODEL_UNAVAILABLE', 404, 'model is unavailable'],
  ['PROVIDER_UNAVAILABLE', undefined, 'could not reach'],
  ['SESSION_SETUP_EXPIRED', undefined, 'setup expired'],
  ['PROVIDER_REJECTED', 400, 'provider HTTP 400'],
  ['PRIVATE', 'PRIVATE', 'service rejected'],
  ['toString', undefined, 'service rejected'],
])('reports %s during call setup and releases resources without retrying', async (code, providerStatus, message) => {
  const s = scenario();
  s.fetchMock.mockImplementation(async url => url === '/api/session'
    ? Response.json({ handle: 'a'.repeat(64), conversationId: 'synthetic', sessionMaxSeconds: 2700 })
    : url === '/api/call' ? Response.json({ code, providerStatus, error: 'PRIVATE' }, { status: 502 }) : Response.json({ ok: true }));
  await s.session.start(true);
  expect(s.states.at(-1)?.status).toBe('error');
  expect(s.states.at(-1)?.message).toContain(message);
  expect(s.states.at(-1)?.message).not.toContain('PRIVATE');
  expect(s.fetchMock.mock.calls.filter(([url]) => url === '/api/call')).toHaveLength(1);
  expect(s.track.stop).toHaveBeenCalledOnce();
  expect(s.peer.close).toHaveBeenCalledOnce();
  expect(s.fetchMock).toHaveBeenCalledWith('/api/capture/end', expect.anything());
});


it.each([
  ['PROVIDER_TIMEOUT', 'timed out'],
  ['PROVIDER_AUTH_FAILED', 'authentication'],
  ['PROVIDER_QUOTA_EXCEEDED', 'quota'],
  ['PROVIDER_RATE_LIMITED', 'rate limited'],
  ['PROVIDER_MODEL_UNAVAILABLE', 'model is unavailable'],
  ['PROVIDER_UNAVAILABLE', 'could not reach'],
  ['AUTH_REQUIRED', 'Sign in'],
])('explains %s even when credential creation fails before SDP exchange', async (code, message) => {
  const s = scenario();
  s.fetchMock.mockResolvedValueOnce(Response.json({ code, error: 'PRIVATE' }, { status: 502 }));
  await s.session.start(true);
  expect(s.states.at(-1)?.message).toContain(message);
  expect(s.states.at(-1)?.message).not.toContain('PRIVATE');
  expect(s.fetchMock).toHaveBeenCalledTimes(1);
  expect(s.track.stop).toHaveBeenCalledOnce();
  expect(s.peer.createDataChannel).not.toHaveBeenCalled();
});
