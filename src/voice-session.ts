export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'ended' | 'error';
export interface VoiceState { status: VoiceStatus; muted: boolean; message: string }
export const initialVoiceState: VoiceState = { status: 'idle', muted: false, message: 'Ready when you are.' };

export interface VoicePlatform {
  fetch: typeof fetch;
  getUserMedia: () => Promise<MediaStream>;
  createPeerConnection: () => RTCPeerConnection;
}

interface Attempt {
  abort: AbortController;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  setupTimer?: ReturnType<typeof setTimeout>;
  sessionTimer?: ReturnType<typeof setTimeout>;
}

/** Owns one connection attempt and all of its media resources. No transcript storage. */
export class VoiceSession {
  private attempt?: Attempt;
  private state: VoiceState = { ...initialVoiceState };

  constructor(
    private audio: HTMLAudioElement,
    private onState: (state: VoiceState) => void,
    private platform: VoicePlatform = {
      fetch: (...args) => fetch(...args),
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
      createPeerConnection: () => new RTCPeerConnection(),
    },
  ) {}

  private update(state: VoiceState) {
    this.state = state;
    this.onState({ ...state });
  }

  private release(attempt: Attempt) {
    attempt.abort.abort();
    clearTimeout(attempt.setupTimer);
    clearTimeout(attempt.sessionTimer);
    attempt.stream?.getTracks().forEach(track => track.stop());
    const channel = attempt.channel;
    if (channel) {
      if (channel.readyState === 'open') {
        // Best-effort cancellation; closing the peer still proceeds if sending fails.
        try { channel.send(JSON.stringify({ type: 'response.cancel' })); } catch { /* Peer will close below. */ }
      }
      channel.onopen = channel.onclose = channel.onerror = channel.onmessage = null;
      channel.close();
    }
    if (attempt.peer) {
      attempt.peer.ontrack = attempt.peer.onconnectionstatechange = null;
      attempt.peer.close();
    }
    this.audio.pause();
    this.audio.srcObject = null;
  }

  dispose() {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (attempt) this.release(attempt);
  }

  end(message = 'Session ended. Your microphone is off.') {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (attempt) this.release(attempt);
    this.update({ status: 'ended', muted: false, message });
  }

  private fail(attempt: Attempt, message: string) {
    if (this.attempt !== attempt) return;
    this.attempt = undefined;
    this.release(attempt);
    this.update({ status: 'error', muted: false, message });
  }

  toggleMute() {
    if (this.state.status !== 'connected' || !this.attempt?.stream) return;
    const muted = !this.state.muted;
    this.attempt.stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    this.update({ ...this.state, muted, message: muted ? 'Microphone muted. End the session when you finish.' : 'Connected. Speak naturally; you can interrupt Voxa.' });
  }

  async start() {
    if (this.attempt) return;
    const attempt: Attempt = { abort: new AbortController() };
    this.attempt = attempt;
    this.update({ status: 'connecting', muted: false, message: 'Allow microphone access to begin.' });
    attempt.setupTimer = setTimeout(() => this.fail(attempt, 'Connection setup timed out. Your microphone is off. Try again.'), 30_000);

    try {
      const stream = await this.platform.getUserMedia();
      if (this.attempt !== attempt) {
        // getUserMedia cannot be aborted. Dispose a late permission result after End.
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      attempt.stream = stream;
      stream.getAudioTracks().forEach(track => {
        track.onended = () => this.fail(attempt, 'Microphone disconnected. Connect it and start again.');
      });
      const credentialResponse = await this.platform.fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: attempt.abort.signal,
      });
      if (this.attempt !== attempt) return;
      if (!credentialResponse.ok) {
        const problem = await credentialResponse.json().catch(() => null) as { code?: string } | null;
        const message = problem?.code === 'API_KEY_REQUIRED'
          ? 'Add the server API key and restart the app to start a voice session.'
          : 'Could not create a session. Check your connection, API key, billing, and model access.';
        throw new Error(message);
      }
      const credential = await credentialResponse.json() as { value?: unknown; sessionMaxSeconds?: unknown };
      if (this.attempt !== attempt) return;
      if (typeof credential.value !== 'string' || !credential.value.startsWith('ek_') ||
          typeof credential.sessionMaxSeconds !== 'number' || !Number.isInteger(credential.sessionMaxSeconds) ||
          credential.sessionMaxSeconds < 30 || credential.sessionMaxSeconds > 300) {
        throw new Error('The server returned an invalid session credential. Try again.');
      }
      const peer = this.platform.createPeerConnection();
      attempt.peer = peer;
      const channel = peer.createDataChannel('oai-events');
      attempt.channel = channel;
      const ready = () => {
        if (this.attempt !== attempt || peer.connectionState !== 'connected' || channel.readyState !== 'open') return;
        if (this.state.status === 'connected') return;
        clearTimeout(attempt.setupTimer);
        this.update({ status: 'connected', muted: false, message: 'Connected. Speak naturally; you can interrupt Voxa.' });
      };
      channel.onopen = ready;
      channel.onclose = () => this.fail(attempt, 'The voice connection closed. Your microphone is off. Start again to reconnect.');
      channel.onerror = () => this.fail(attempt, 'The voice connection failed. Your microphone is off. Try again.');
      channel.onmessage = event => {
        // Inspect only the event type. Do not log, save, or display conversation payloads.
        try {
          if (JSON.parse(String(event.data)).type === 'error') {
            this.fail(attempt, 'The voice service reported an error. Your microphone is off. Try again.');
          }
        } catch { /* Ignore non-JSON events. */ }
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
          this.fail(attempt, 'Connection lost. Your microphone is off. Start again to reconnect.');
        } else ready();
      };
      peer.ontrack = event => {
        if (this.attempt !== attempt) return;
        this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void this.audio.play().catch(() => this.fail(attempt, 'Audio playback was blocked. Allow sound for this page and start again.'));
      };
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      const offer = await peer.createOffer();
      if (this.attempt !== attempt) return;
      await peer.setLocalDescription(offer);
      if (this.attempt !== attempt) return;
      // The safety timeout covers the provider connection as well as conversation time.
      attempt.sessionTimer = setTimeout(() => {
        if (this.attempt === attempt) this.end('Trial time limit reached. Your microphone is off.');
      }, credential.sessionMaxSeconds * 1000);
      const answer = await this.platform.fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', body: offer.sdp,
        headers: { Authorization: `Bearer ${credential.value}`, 'Content-Type': 'application/sdp' },
        signal: attempt.abort.signal,
      });
      if (this.attempt !== attempt) return;
      if (!answer.ok) throw new Error('OpenAI could not connect the voice call. Check model access and try again.');
      const sdp = await answer.text();
      if (this.attempt !== attempt) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      const permissionError = error instanceof Error && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      const message = permissionError
        ? 'Microphone access was denied. Allow it in your browser, then try again.'
        : error instanceof Error && error.message.startsWith('The server returned') ? error.message
        : error instanceof Error && error.message.startsWith('Add the server') ? error.message
        : error instanceof Error && error.message.startsWith('Could not create') ? error.message
        : error instanceof Error && error.message.startsWith('OpenAI could not') ? error.message
        : 'Could not start the voice session. Check your microphone and connection, then try again.';
      this.fail(attempt, message);
    }
  }
}
