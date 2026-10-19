import { isSummaryPreview } from './shared/continuity';
import { LiveTranscript, type LiveTurn } from './live-transcript';
import { initialTurnPreference, turnPreference, type TurnPreference, type TurnStyle } from './turn-style';
import { realtimeProtocol, type RealtimeProtocol } from './providers/realtime-protocol';
export type MicrophoneProfile = 'laptop' | 'headset';
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'ended' | 'error';
export interface SaveStatus { state: 'off' | 'saving' | 'finalizing' | 'saved' | 'delayed' | 'incomplete'; conversationId?: string }
export interface VoiceState { status: VoiceStatus; muted: boolean; message: string; turnStyle?: TurnStyle; turnStyleLocked?: boolean }
export const initialVoiceState: VoiceState = { status: 'idle', muted: false, message: 'Ready when you are.' };

export interface VoicePlatform {
  fetch: typeof fetch;
  getUserMedia: () => Promise<MediaStream>;
  createPeerConnection: () => RTCPeerConnection;
}

interface Attempt {
  abort: AbortController;
  protocol: RealtimeProtocol;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  setupTimer?: ReturnType<typeof setTimeout>;
  sessionTimer?: ReturnType<typeof setTimeout>;
  captureHandle?: string;
  saveRequested?: boolean;
  inputActive?: boolean;
  context?: { itemId: string; text: string };
  contextSent?: boolean;
  contextReady?: boolean;
  preference: TurnPreference;
  appliedStyle: TurnStyle;
  styleRequest?: TurnStyle;
  styleRequestId?: string;
  styleSequence: number;
  styleTimer?: ReturnType<typeof setTimeout>;
  responseActive?: boolean;
  outputActive?: boolean;
  transcriptIds: Set<string>;
  captions: LiveTranscript;
  captionTimer?: ReturnType<typeof setTimeout>;
}

/** Owns audio resources. Persistence failures are reported independently of voice state. */
export class VoiceSession {
  private attempt?: Attempt;
  private state: VoiceState = { ...initialVoiceState };
  private saveGeneration = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private audio: HTMLAudioElement,
    private onState: (state: VoiceState) => void,
    private platform: VoicePlatform = {
      fetch: (...args) => fetch(...args),
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
      createPeerConnection: () => new RTCPeerConnection(),
    },
    private onSave: (status: SaveStatus) => void = () => {},
    private onTranscript: (turns: LiveTurn[]) => void = () => {},
  ) {}

  private update(state: VoiceState) {
    this.state = state;
    this.onState({ ...state });
  }

  private release(attempt: Attempt, drain = false) {
    attempt.abort.abort();
    clearTimeout(attempt.setupTimer);
    clearTimeout(attempt.sessionTimer);
    clearTimeout(attempt.styleTimer);
    clearTimeout(attempt.captionTimer);
    attempt.stream?.getTracks().forEach(track => track.stop());
    const channel = attempt.channel;
    if (channel) {
      if (channel.readyState === 'open') {
        // Best-effort cancellation; closing the peer still proceeds if sending fails.
        try { channel.send(JSON.stringify(attempt.protocol.cancel())); } catch { /* Peer will close below. */ }
      }
      channel.onopen = channel.onclose = channel.onerror = channel.onmessage = null;
    }
    if (attempt.peer) {
      attempt.peer.ontrack = attempt.peer.onconnectionstatechange = null;
    }
    this.audio.pause();
    this.audio.srcObject = null;
    const closeTransport = () => { channel?.close(); attempt.peer?.close(); };
    if (drain && attempt.saveRequested && attempt.captureHandle && channel?.readyState === 'open' && attempt.peer?.connectionState === 'connected') {
      // Stop capture/playback now, but retain the transport for pending ASR events.
      // Allow in-flight microphone packets to arrive before a best-effort final commit.
      if (attempt.inputActive) setTimeout(() => {
        if (channel.readyState === 'open') {
          try { channel.send(JSON.stringify(attempt.protocol.commit())); } catch { /* Capture will be marked incomplete if finalization fails. */ }
        }
      }, 200);
      setTimeout(closeTransport, 15_000);
    } else closeTransport();
    if (attempt.captureHandle) {
      void this.platform.fetch('/api/capture/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: attempt.captureHandle }), keepalive: true, signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
  }

  dispose() {
    this.saveGeneration++; clearTimeout(this.saveTimer);
    const attempt = this.attempt;
    this.attempt = undefined;
    if (attempt) this.release(attempt);
  }

  end(message = 'Session ended. Your microphone is off.') {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (attempt?.captureHandle && attempt.saveRequested) this.onSave({ state: 'finalizing' });
    if (attempt) { attempt.captions.finish(); this.onTranscript(attempt.captions.snapshot()); this.release(attempt, true); }
    if (attempt && !attempt.saveRequested) this.onSave({ state: 'off' });
    this.update({ status: 'ended', muted: false, message });
  }

  private fail(attempt: Attempt, message: string) {
    if (this.attempt !== attempt) return;
    this.attempt = undefined;
    attempt.captions.finish(); this.onTranscript(attempt.captions.snapshot());
    this.release(attempt);
    if (attempt.saveRequested && !attempt.captureHandle) this.onSave({ state: 'incomplete' });
    this.update({ status: 'error', muted: false, message });
  }

  toggleMute() {
    if (this.state.status !== 'connected' || !this.attempt?.stream) return;
    const muted = !this.state.muted;
    this.attempt.stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    this.update({ ...this.state, muted, message: muted ? 'Microphone muted. End the session when you finish.' : 'Connected. Speak naturally; you can interrupt Voxa.' });
  }

  private styleUnavailable(attempt: Attempt) {
    clearTimeout(attempt.styleTimer);
    attempt.styleRequest = undefined;
    // Keep voice and the last acknowledged setting; do not loop retries on every event.
    attempt.preference = { style: attempt.appliedStyle, locked: attempt.preference.locked };
    if (this.attempt === attempt && this.state.status === 'connected') this.update({ ...this.state, message: 'Turn-taking could not be changed. Conversation can continue; try the command again.' });
  }

  private applyTurnStyle(attempt: Attempt) {
    if (attempt.styleRequest || attempt.preference.style === attempt.appliedStyle || attempt.inputActive || attempt.responseActive || attempt.outputActive || attempt.channel?.readyState !== 'open') return;
    attempt.styleRequest = attempt.preference.style;
    try {
      attempt.channel.send(JSON.stringify(attempt.protocol.turnStyle(attempt.styleRequest, attempt.styleRequestId = `voxa_turn_style_${++attempt.styleSequence}`)));
      attempt.styleTimer = setTimeout(() => {
        if (this.attempt === attempt) this.styleUnavailable(attempt);
      }, 5000);
    } catch { this.styleUnavailable(attempt); }
  }

  private watchSaving(handle: string, conversationId: string, attempt: Attempt) {
    const generation = this.saveGeneration;
    let stoppedPolls = 0;
    const poll = async () => {
      if (generation !== this.saveGeneration) return;
      let finished = false;
      try {
        const response = await this.platform.fetch('/api/capture/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle }), signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('Capture unavailable');
        const status = await response.json() as { state: SaveStatus['state']; ended: boolean; pending: number };
        if (!['saving', 'finalizing', 'saved', 'delayed', 'incomplete'].includes(status.state)) throw new Error('Invalid status');
        finished = status.ended && status.pending === 0;
        if (generation === this.saveGeneration) this.onSave({ state: status.state, conversationId });
      } catch { if (generation === this.saveGeneration) this.onSave({ state: 'delayed', conversationId }); }
      if (generation !== this.saveGeneration || finished) return;
      if (this.attempt !== attempt && ++stoppedPolls >= 10) { this.onSave({ state: 'incomplete', conversationId }); return; }
      this.saveTimer = setTimeout(() => void poll(), 2000);
    };
    this.saveTimer = setTimeout(() => void poll(), 1000);
  }

  async start(save = false, contextToken?: string, contextIds: string[] = [], microphone?: MicrophoneProfile) {
    if (this.attempt) return;
    this.saveGeneration++; clearTimeout(this.saveTimer);
    this.onSave({ state: save ? 'saving' : 'off' });
    const attempt: Attempt = { abort: new AbortController(), protocol: realtimeProtocol(), saveRequested: save, preference: { ...initialTurnPreference }, appliedStyle: 'everyday', transcriptIds: new Set(), styleSequence: 0, captions: new LiveTranscript() };
    this.attempt = attempt;
    this.onTranscript([]);
    this.update({ status: 'connecting', muted: false, message: 'Allow microphone access to begin.' });
    attempt.setupTimer = setTimeout(() => this.fail(attempt, 'Connection setup timed out. Your microphone is off. Try again.'), 30_000);

    try {
      if (!contextToken && contextIds.length) {
        this.update({ status: 'connecting', muted: false, message: 'Loading selected summaries. Your microphone is off.' });
        const previewResponse = await this.platform.fetch('/api/context/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: contextIds, summariesOnly: true }), signal: attempt.abort.signal,
        });
        if (this.attempt !== attempt) return;
        if (!previewResponse.ok) throw new Error('Saved history could not be loaded. Review your selection in Saved conversations and try again.');
        const preview: unknown = await previewResponse.json();
        if (this.attempt !== attempt) return;
        if (!isSummaryPreview(preview, contextIds)) throw new Error('Saved history could not be loaded. Review your selection in Saved conversations and try again.');
        contextToken = preview.token;
      }
      const stream = await this.platform.getUserMedia();
      if (this.attempt !== attempt) {
        // getUserMedia cannot be aborted. Dispose a late permission result after End.
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      attempt.stream = stream;
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
      stream.getAudioTracks().forEach(track => {
        track.onended = () => this.fail(attempt, 'Microphone disconnected. Connect it and start again.');
      });
      const credentialResponse = await this.platform.fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ save, ...(contextToken ? { contextToken } : {}), ...(microphone ? { microphone } : {}) }), signal: attempt.abort.signal,
      });
      if (this.attempt !== attempt) return;
      if (!credentialResponse.ok) {
        const problem = await credentialResponse.json().catch(() => null) as { code?: string } | null;
        const message = ['HISTORY_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'NO_CONTEXT'].includes(problem?.code || '') ? 'Saved history is unavailable. Your microphone is off. Try again.' : problem?.code?.startsWith('PREVIEW_') ? 'Saved history changed during setup. Start again.' : problem?.code === 'API_KEY_REQUIRED'
          ? 'Add the server API key and restart the app to start a voice session.'
          : 'Could not create a session. Check your connection, API key, billing, and model access.';
        throw new Error(message);
      }
      const credential = await credentialResponse.json() as { protocol?: unknown; value?: unknown; handle?: unknown; conversationId?: unknown; sessionMaxSeconds?: unknown; context?: { itemId?: unknown; text?: unknown } };
      if (this.attempt !== attempt) return;
      const managedSession = typeof credential.handle === 'string' && /^[a-f0-9]{64}$/.test(credential.handle) && typeof credential.conversationId === 'string';
      attempt.protocol = realtimeProtocol(credential.protocol);
      const directSession = attempt.protocol.isCredential(credential.value);
      if ((!managedSession && !directSession) ||
          typeof credential.sessionMaxSeconds !== 'number' || !Number.isInteger(credential.sessionMaxSeconds) ||
          credential.sessionMaxSeconds < 30 || credential.sessionMaxSeconds > 2700) {
        throw new Error('The server returned an invalid session credential. Try again.');
      }
      if (managedSession) {
        attempt.captureHandle = credential.handle as string;
        if (save) {
          this.onSave({ state: 'saving', conversationId: credential.conversationId as string });
          this.watchSaving(attempt.captureHandle, credential.conversationId as string, attempt);
        }
      } else if (save) this.onSave({ state: 'incomplete' });
      if (contextToken || credential.context) {
        if (!contextToken || !managedSession || typeof credential.context?.itemId !== 'string' || !/^voxa_context_[a-f0-9]{18}$/.test(credential.context.itemId) || typeof credential.context.text !== 'string' || !credential.context.text || new TextEncoder().encode(credential.context.text).length > 6000) throw new Error('Saved history could not be loaded. Start again.');
        attempt.context = { itemId: credential.context.itemId, text: credential.context.text };
      }
      const peer = this.platform.createPeerConnection();
      attempt.peer = peer;
      const channel = peer.createDataChannel(attempt.protocol.dataChannelName);
      attempt.channel = channel;
      const ready = () => {
        if (this.attempt !== attempt || peer.connectionState !== 'connected' || channel.readyState !== 'open') return;
        if (this.state.status === 'connected') return;
        if (attempt.context && !attempt.contextReady) {
          if (!attempt.contextSent) {
            attempt.contextSent = true;
            this.update({ status: 'connecting', muted: false, message: 'Loading your previous conversations…' });
            try { channel.send(JSON.stringify(attempt.protocol.context(attempt.context.itemId, attempt.context.text))); }
            catch { this.fail(attempt, 'Saved history could not be loaded. Start again.'); }
          }
          return;
        }
        stream.getAudioTracks().forEach(track => { track.enabled = true; });
        clearTimeout(attempt.setupTimer);
        this.update({ status: 'connected', muted: false, message: 'Connected. Speak naturally; you can interrupt Voxa.', turnStyle: attempt.appliedStyle, turnStyleLocked: attempt.preference.locked });
      };
      channel.onopen = ready;
      channel.onclose = () => this.fail(attempt, 'The voice connection closed. Your microphone is off. Start again to reconnect.');
      channel.onerror = () => this.fail(attempt, 'The voice connection failed. Your microphone is off. Try again.');
      channel.onmessage = event => {
        // Normalize only supported fields. Never log raw events, credentials or speech.
        try {
          if (this.attempt !== attempt) return;
          const providerEvent = attempt.protocol.event(JSON.parse(String(event.data)));
          if (providerEvent.caption && providerEvent.caption.itemId !== attempt.context?.itemId && attempt.captions.accept(providerEvent.caption)) {
            if (providerEvent.caption.kind === 'final' || providerEvent.caption.kind === 'failed') {
              clearTimeout(attempt.captionTimer); attempt.captionTimer = undefined;
              this.onTranscript(attempt.captions.snapshot());
            } else if (!attempt.captionTimer) {
              attempt.captionTimer = setTimeout(() => {
                attempt.captionTimer = undefined;
                if (this.attempt === attempt) this.onTranscript(attempt.captions.snapshot());
              }, 80);
            }
          }
          if (providerEvent.contextItemId === attempt.context?.itemId && attempt.context && providerEvent.contextItemId) { attempt.contextReady = true; ready(); }
          if (providerEvent.inputActive !== undefined) attempt.inputActive = providerEvent.inputActive;
          if (providerEvent.responseActive !== undefined) attempt.responseActive = providerEvent.responseActive;
          if (providerEvent.outputActive !== undefined) attempt.outputActive = providerEvent.outputActive;
          if (providerEvent.userTranscript && !attempt.transcriptIds.has(providerEvent.userTranscript.id) && providerEvent.userTranscript.id !== attempt.context?.itemId) {
            // Bound deduplication to the provider's existing per-session item budget.
            if (attempt.transcriptIds.size < 2000) {
              attempt.transcriptIds.add(providerEvent.userTranscript.id);
              attempt.preference = turnPreference(providerEvent.userTranscript.text, attempt.preference);
            }
          }
          if (providerEvent.acknowledgedStyle) {
            if (!attempt.styleRequest) attempt.preference = { ...attempt.preference, style: providerEvent.acknowledgedStyle };
            attempt.appliedStyle = providerEvent.acknowledgedStyle;
            if (attempt.styleRequest === providerEvent.acknowledgedStyle) {
              clearTimeout(attempt.styleTimer);
              attempt.styleRequest = undefined;
            }
          }
          if (providerEvent.styleRejected && providerEvent.styleRejected === attempt.styleRequestId && attempt.styleRequest) this.styleUnavailable(attempt);
          if (this.state.status === 'connected' && this.attempt === attempt) {
            if (this.state.turnStyle !== attempt.appliedStyle || this.state.turnStyleLocked !== attempt.preference.locked) this.update({ ...this.state, turnStyle: attempt.appliedStyle, turnStyleLocked: attempt.preference.locked });
            this.applyTurnStyle(attempt);
          }
          if (providerEvent.failed) {
            this.fail(attempt, `The voice service reported an error${providerEvent.errorCode ? ` (${providerEvent.errorCode})` : ''}. Your microphone is off. Try again.`);
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
        if (this.attempt === attempt) this.end('Session time limit reached. Your microphone is off.');
      }, credential.sessionMaxSeconds * 1000);
      const signaling = managedSession
        ? { url: '/api/call', body: JSON.stringify({ handle: credential.handle, sdp: offer.sdp }), headers: { 'Content-Type': 'application/json' } }
        : attempt.protocol.directCall(String(credential.value), offer.sdp);
      const answer = await this.platform.fetch(signaling.url, {
        method: 'POST', body: signaling.body, headers: signaling.headers,
        signal: attempt.abort.signal,
      });
      if (this.attempt !== attempt) return;
      if (!answer.ok) throw new Error('The voice provider could not connect the voice call. Check model access and try again.');
      const sdp = await answer.text();
      if (this.attempt !== attempt) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      const permissionError = error instanceof Error && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      const message = permissionError
        ? 'Microphone access was denied. Allow it in your browser, then try again.'
        : error instanceof Error && error.message.startsWith('The server returned') ? error.message
        : error instanceof Error && error.message.startsWith('Saved history') ? error.message
        : error instanceof Error && error.message.startsWith('Add the server') ? error.message
        : error instanceof Error && error.message.startsWith('Could not create') ? error.message
        : error instanceof Error && error.message.startsWith('The voice provider could not') ? error.message
        : 'Could not start the voice session. Check your microphone and connection, then try again.';
      this.fail(attempt, message);
    }
  }
}
