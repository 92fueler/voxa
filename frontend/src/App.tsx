import { useCallback, useEffect, useRef, useState } from 'react';
import { initialVoiceState, VoiceSession, type VoiceState, type SaveStatus } from './voice-session';

import { SavedConversations } from './SavedConversations';

interface Health { realtimeConfigured: boolean; model: string; sessionMaxSeconds: number }

function MicIcon({ muted = false }: { muted?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    {muted && <path d="m3 3 18 18" />}
  </svg>;
}

export function App() {
  const audio = useRef<HTMLAudioElement>(null);
  const session = useRef<VoiceSession | null>(null);
  const [voice, setVoice] = useState<VoiceState>(initialVoiceState);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState<SaveStatus>({ state: 'off' });

  const checkBackend = useCallback((signal?: AbortSignal) => {
    return fetch('/api/health', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) })
      .then(async response => { if (!response.ok) throw new Error('Unavailable'); return await response.json() as Health; })
      .then(value => { if (!signal?.aborted) { setHealth(value); setHealthError(false); } })
      .catch(() => { if (!signal?.aborted) { setHealth(null); setHealthError(true); } })
      .finally(() => { if (!signal?.aborted) setChecking(false); });
  }, []);

  useEffect(() => {
    const controller = new VoiceSession(audio.current!, setVoice, undefined, setSaving);
    session.current = controller;
    const healthCheck = new AbortController();
    void checkBackend(healthCheck.signal);
    const leave = () => controller.end();
    window.addEventListener('pagehide', leave);
    return () => { healthCheck.abort(); window.removeEventListener('pagehide', leave); controller.dispose(); session.current = null; };
  }, [checkBackend]);

  const startConversation = () => { void session.current?.start(true); };
  const active = voice.status === 'connecting' || voice.status === 'connected';
  const canStart = !checking && health?.realtimeConfigured && !active;

  return <div className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="Voxa home">Voxa</a>
    </header>

    <main>
      <div className="eyebrow"><span className="small-line" /> A LITTLE SPACE TO THINK</div>
      <h1>Good ideas start<br />with a conversation.</h1>
      <p className="intro">Say what’s on your mind. Work through an idea.<br className="desktop-break" /> Hear another perspective, then try again.</p>

      <section className="conversation" aria-label="Voice conversation">
        <div className={`voice-emblem ${voice.status === 'connected' && !voice.muted ? 'is-connected' : ''}`} aria-hidden="true">
          <div className="emblem-circle"><div className="sound-lines">{[22, 38, 56, 72, 48, 32, 56, 40, 22].map((height, i) => <i key={i} style={{ height, animationDelay: `${i * 0.1}s` }} />)}</div></div>
        </div>
        <div className="voice-state" aria-live="polite">
          <h2>{voice.status === 'connected' ? voice.muted ? 'Take your time.' : 'I’m listening.' : voice.status === 'connecting' ? 'Let’s get connected.' : 'Your voice. A little clarity.'}</h2>
          <p>{voice.message}</p>
        </div>
        <div className="session-controls">
          {!active ? <button className="button primary" disabled={!canStart} onClick={startConversation}><MicIcon />Start conversation</button>
            : <><button className="button secondary" disabled={voice.status !== 'connected'} aria-pressed={voice.muted} onClick={() => session.current?.toggleMute()}><MicIcon muted={voice.muted} />{voice.muted ? 'Unmute' : 'Mute'}</button><button className="button end" onClick={() => session.current?.end()}><span className="stop-icon" />End session</button></>}
        </div>
        {saving.state !== 'off' && <p className={`save-status ${saving.state}`} role="status">{saving.state === 'saving' ? 'Saving transcript…' : saving.state === 'finalizing' ? 'Finishing final transcript… Microphone is off.' : saving.state === 'saved' ? 'Received turns saved locally' : saving.state === 'delayed' ? 'Saving delayed. Conversation can continue.' : 'Capture incomplete. Some turns may not be saved.'}</p>}
        <audio ref={audio} autoPlay />
      </section>

      {(!health?.realtimeConfigured || healthError) && <aside className="setup-note" aria-label="Connection setup">
        <span className="setup-number">01</span><div><strong>{checking ? 'Checking your local connection…' : healthError ? 'Start the local backend to continue.' : 'One small setup step before we talk.'}</strong>
          <p>{healthError ? 'Run make dev from the repo, then check again.' : 'Add your OpenAI API key to the backend/.env file, restart the app, and check again. Your key stays on your computer’s backend.'}</p></div>
        <button className="text-button" onClick={() => { setChecking(true); setHealthError(false); void checkBackend(); }} disabled={checking}>{checking ? 'Checking…' : 'Check again'}<span aria-hidden="true">↗</span></button>
      </aside>}

      <SavedConversations active={active} conversationId={saving.conversationId} />

      <section className="conversation-starters" aria-label="Ideas for your first conversation">
        <div className="section-label">NOT SURE WHERE TO START?</div>
        <div className="starter-grid">
          <article><span className="starter-index">01 / THINK</span><h3>Talk an idea through.</h3><p>“Let me explain how a cache works. Tell me where I’m missing something.”</p></article>
          <article><span className="starter-index">02 / EXPRESS</span><h3>Find the right words.</h3><p>“我想表达这个想法。How would you say it naturally in English?”</p></article>
          <article><span className="starter-index">03 / EXPLORE</span><h3>Follow your curiosity.</h3><p>“Help me understand this concept. Start with a simple example.”</p></article>
        </div>
      </section>
    </main>
    <footer><span>A conversation, at your pace.</span>
      <details className="privacy-details"><summary>Privacy &amp; memory</summary><div>
        <p>Conversation text is saved on this computer for 30 days. No audio recordings are stored. You can delete saved conversations at any time.</p>
        <p>New conversations automatically use compact context from up to three recent ended sessions. Titles and summaries are prepared after final saving and use the OpenAI API.</p>
      </div></details>
      <span>{health ? `${health.sessionMaxSeconds / 60}-minute session limit` : 'Local prototype'}</span></footer>
  </div>;
}
