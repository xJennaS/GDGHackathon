import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage, runAgent, type Content, type LogStatus } from './agent';
import type { Card } from './cards';
import { CardView } from './CardView';
import { showAgentTabs } from './tabs';
import { Button, Chip, Dialog, Drawer, Icon, IconButton, SegmentedControl, Skeleton, StatusPill, Tooltip } from './components/ui';

const DEFAULT_BACKEND: string = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
const SpeechRecognition: (new () => any) | undefined = (window as any).webkitSpeechRecognition;
const SUGGESTIONS = [
  { label: 'Read my latest email', prompt: 'Read me my latest email.', icon: 'mail' as const },
  { label: 'Check my schedule for Thursday', prompt: "She's asking to meet Thursday. Am I free? If so, say yes and put it on my calendar.", icon: 'calendar' as const },
  { label: "Compare today's top AI stories", prompt: "What's on Hacker News about AI today? Compare the top 3.", icon: 'table' as const },
  { label: 'Help me reply', prompt: 'Help me draft a reply to my latest email.', icon: 'mail' as const },
];

type ThemePreference = 'system' | 'light' | 'dark';
type Turn = { id: number; prompt: string; cards: Card[] };
type LogEntry = { id: number; label: string; status: LogStatus };
type Panel = 'activity' | 'sources' | null;

const STATUS_ICON: Record<LogStatus, { glyph: string; name: string }> = {
  running: { glyph: '', name: 'Running' },
  done: { glyph: '✓', name: 'Done' },
  failed: { glyph: '!', name: 'Failed' },
};

function cardSources(card: Card): string[] {
  if (card.type === 'answer' || card.type === 'table') return card.sources;
  if (card.type === 'email') return card.url ? [card.url] : [];
  if (card.type === 'calendar') {
    const [year, month, day] = card.date.split('-');
    return [`https://calendar.google.com/calendar/r/day/${year}/${Number(month)}/${Number(day)}`];
  }
  return [];
}

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function App() {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND);
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [themeReady, setThemeReady] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const contents = useRef<Content[]>([]);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const input = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const recognition = useRef<any>(null);

  useEffect(() => {
    chrome.storage.local.get(['backendUrl', 'themePreference']).then((saved) => {
      if (typeof saved.backendUrl === 'string' && saved.backendUrl) setBackendUrl(saved.backendUrl);
      if (saved.themePreference === 'system' || saved.themePreference === 'light' || saved.themePreference === 'dark') {
        setTheme(saved.themePreference);
      }
      setThemeReady(true);
    });
    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      const value = changes.themePreference?.newValue;
      if (value === 'system' || value === 'light' || value === 'dark') setTheme(value);
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (themeReady) void chrome.storage.local.set({ themePreference: theme });
  }, [theme, themeReady]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setPanel(null);
        setSettingsOpen(false);
      }
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'INPUT') {
        event.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Voice fills the input; the user still presses Enter, so a misheard request never runs by itself.
  function toggleMic() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new SpeechRecognition!();
    r.lang = navigator.language;
    r.interimResults = true;
    r.onresult = (e: any) => setText(Array.from(e.results, (result: any) => result[0].transcript).join(''));
    r.onerror = (e: any) =>
      setNotice(e.error === 'not-allowed' ? 'Microphone access is blocked. Allow it for this page, then try again.' : `Voice input failed: ${e.error}.`);
    r.onend = () => {
      setListening(false);
      input.current?.focus();
    };
    recognition.current = r;
    setNotice('Listening. Speak your request, then press Enter to send.');
    setListening(true);
    r.start();
  }

  async function send(raw: string) {
    const prompt = raw.trim();
    if (!prompt || running) return;
    const turnId = nextId.current++;
    const controller = new AbortController();
    abort.current = controller;
    recognition.current?.stop();
    setText('');
    setNotice('');
    setLog([]);
    setRunning(true);
    setTurns((all) => [{ id: turnId, prompt, cards: [] }, ...all]);
    const addCards = (cards: Card[], atFront: boolean) =>
      setTurns((all) =>
        all.map((t) => (t.id === turnId ? { ...t, cards: atFront ? [...cards, ...t.cards] : [...t.cards, ...cards] } : t)),
      );

    let final: Card[];
    try {
      final = await runAgent(prompt, contents.current, {
        backendUrl,
        signal: controller.signal,
        log: (label) => {
          const id = nextId.current++;
          setLog((entries) => [...entries, { id, label, status: 'running' }]);
          return id;
        },
        update: (id, status, label) => setLog((entries) => entries.map((e) => (e.id === id ? { id, status, label } : e))),
        onApproval: (card) => addCards([card], false),
      });
    } catch (e) {
      final = [
        controller.signal.aborted
          ? { type: 'error', message: 'Cancelled.', recovery: 'Nothing else will run for this request.' }
          : { type: 'error', message: errorMessage(e), recovery: 'Check the activity log and the backend URL, then try again.' },
      ];
    }
    addCards(final, true);
    setRunning(false);
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(text);
    }
  }

  function updateTheme(value: ThemePreference) {
    setTheme(value);
    void chrome.storage.local.set({ themePreference: value });
  }

  const current = log.at(-1);
  const statusText = running ? current?.label ?? 'Working' : notice || (turns.length ? 'Ready for your next request' : 'Ready');
  const tone = running ? 'running' : log.some((item) => item.status === 'failed') ? 'error' : turns.length ? 'success' : 'neutral';
  const sourceUrls = [...new Set(turns.flatMap((turn) => turn.cards.flatMap(cardSources)))];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#" className="wordmark" aria-label="Tabless home" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <Icon name="sparkle" />
          <span>Tabless</span>
        </a>
        <div className="top-actions">
          {turns.length > 0 && <StatusPill tone={tone}>{running ? statusText : tone === 'error' ? 'Needs attention' : 'Ready'}</StatusPill>}
          <Tooltip label="Sources">
            <IconButton label="Sources" onClick={() => setPanel('sources')}><Icon name="source" /></IconButton>
          </Tooltip>
          <Tooltip label="Activity">
            <IconButton label="Activity" onClick={() => setPanel('activity')}><Icon name="activity" /></IconButton>
          </Tooltip>
          <Tooltip label="Settings">
            <IconButton label="Settings" onClick={() => setSettingsOpen(true)}><Icon name="settings" /></IconButton>
          </Tooltip>
        </div>
      </header>

      <main className="main-layout">
        <div className="main-column">
          {!turns.length && (
            <section className="hero" aria-labelledby="welcome-heading">
              <h1 id="welcome-heading" className="hero-title"><span className="gradient-text">Hello there</span></h1>
              <p className="hero-question">What do you need to do?</p>
              <p className="hero-copy">Ask for anything. Tabless handles the browsing.</p>
              <nav className="suggestions" aria-label="Try a suggestion">
                {SUGGESTIONS.map((suggestion) => (
                  <Chip key={suggestion.label} disabled={running} onClick={() => void send(suggestion.prompt)}>
                    <Icon name={suggestion.icon} />{suggestion.label}
                  </Chip>
                ))}
              </nav>
            </section>
          )}

          <section aria-label="Request">
            <form
              className="composer-wrap"
              onSubmit={(event) => {
                event.preventDefault();
                void send(text);
              }}
            >
              <div className="composer">
                <label htmlFor="request" className="sr-only">Your request</label>
                <textarea
                  id="request"
                  ref={input}
                  autoFocus
                  rows={1}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    event.target.style.height = 'auto';
                    event.target.style.height = `${Math.min(event.target.scrollHeight, 220)}px`;
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything"
                />
                <div className="composer-tools">
                  {SpeechRecognition && (
                    <IconButton
                      className={listening ? 'mic-button recording' : 'mic-button'}
                      onClick={toggleMic}
                      disabled={running}
                      aria-pressed={listening}
                      label={listening ? 'Stop voice input' : 'Start voice input'}
                    >
                      <Icon name="mic" />
                    </IconButton>
                  )}
                  {running ? (
                    <Button type="button" className="send-button" aria-label="Cancel request" title="Cancel request" onClick={() => abort.current?.abort()}>
                      <Icon name="stop" />
                    </Button>
                  ) : (
                    <Button type="submit" className="send-button" disabled={!text.trim()} aria-label="Send request" title="Send request">
                      <Icon name="send" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="composer-hint">Enter to send, Shift+Enter for new line, / to focus</p>
              <p className="voice-status" aria-live="polite">{notice || (listening ? 'Listening. Speak your request, then press Enter to send.' : '')}</p>
            </form>
          </section>

          <p role="status" aria-live="polite" className="status-row">
            {running && <Icon name="sparkle" />}
            {statusText}
          </p>

          <div className="turn-list">
            {turns.map((turn) => (
              <section key={turn.id} aria-label={`Answer to: ${turn.prompt}`} className="turn">
                <h2 className="turn-prompt">{turn.prompt}</h2>
                {turn.cards.length === 0 && running && (
                  <div className="turn-cards" aria-label="Loading response">
                    <div className="turn-response"><Icon name="sparkle" /><span>{statusText}</span></div>
                    <Skeleton className="skeleton-card" />
                  </div>
                )}
                <div className="turn-cards">
                  {turn.cards.map((card, index) => (
                    <CardView
                      key={card.type === 'approval' ? card.approvalId : index}
                      card={card}
                      onReply={() => {
                        setText('Help me draft a reply to this email.');
                        input.current?.focus();
                      }}
                      onRetry={() => void send(turn.prompt)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <footer className="footer-note">Your requests stay in this tab.</footer>
        </div>
      </main>

      {panel && (
        <Drawer title={panel === 'activity' ? 'Activity' : 'Sources'} onClose={() => setPanel(null)}>
          {panel === 'activity' ? (
            <>
              {log.length === 0 ? (
                <p className="card-muted">Each real step the agent takes appears here.</p>
              ) : (
                <ol className="activity-list">
                  {log.map((entry) => {
                    const icon = STATUS_ICON[entry.status];
                    return (
                      <li key={entry.id} className="activity-item">
                        <span className={`activity-marker ${entry.status}`} aria-hidden="true">
                          {entry.status === 'running' ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon.glyph}
                        </span>
                        <span>
                          <span className="sr-only">{icon.name}: </span>
                          {entry.label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <Button variant="outlined" className="w-full" onClick={async () => {
                setNotice((await showAgentTabs()) ? 'Expanded the Tabless tab group in the tab strip.' : 'The agent has not opened any tabs yet.');
                setPanel(null);
              }}>Show the tabs</Button>
            </>
          ) : sourceUrls.length ? (
            <ul className="source-list">
              {sourceUrls.map((url) => (
                <li key={url} className="w-full list-none">
                  <a className="source-link" href={url} target="_blank" rel="noreferrer">{sourceHostname(url)}</a>
                </li>
              ))}
            </ul>
          ) : <p className="card-muted">Sources will appear here with your results.</p>}
        </Drawer>
      )}

      {settingsOpen && (
        <Dialog title="Settings" onClose={() => setSettingsOpen(false)}>
          <section className="settings-section">
            <h3>Connection</h3>
            <label htmlFor="backend-url" className="settings-helper">Backend URL</label>
            <input
              id="backend-url"
              type="url"
              value={backendUrl}
              onChange={(event) => {
                setBackendUrl(event.target.value);
                void chrome.storage.local.set({ backendUrl: event.target.value });
              }}
              className="backend-input"
            />
          </section>
          <section className="settings-section">
            <h3>Privacy</h3>
            <p className="settings-helper">Webpage and email content is used to answer your current request. Treat it as sensitive.</p>
          </section>
          <section className="settings-section">
            <h3>Voice</h3>
            <p className="settings-helper">{SpeechRecognition ? 'Voice input is available in this browser.' : 'Voice input is not supported in this browser.'} Spoken text is not sent until you submit the request.</p>
          </section>
          <section className="settings-section">
            <h3>Appearance</h3>
            <SegmentedControl
              label="Theme"
              value={theme}
              options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
              onChange={updateTheme}
            />
          </section>
          <section className="settings-section">
            <h3>Permissions</h3>
            <p className="settings-helper">Tabs, tab groups, page reading, and local storage are used to complete your requests.</p>
          </section>
          <section className="settings-section">
            <h3>About</h3>
            <p className="settings-helper">Tabless helps with browsing while keeping original pages one click away.</p>
            <p className="settings-helper">Powered by Gemini on Google Cloud</p>
          </section>
        </Dialog>
      )}
    </div>
  );
}
