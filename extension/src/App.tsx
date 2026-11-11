import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage, runAgent, type Content, type LogStatus } from './agent';
import type { Card } from './cards';
import { CardView } from './CardView';
import { showAgentTabs } from './tabs';

const DEFAULT_BACKEND: string = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
// Chrome-only and untyped. The mic button is hidden where it is missing.
const SpeechRecognition: (new () => any) | undefined = (window as any).webkitSpeechRecognition;
const CHIPS = [
  'Read me my latest email.',
  "She's asking to meet Thursday. Am I free? If so, say yes and put it on my calendar.",
  "What's on Hacker News about AI today? Compare the top 3.",
];

type Turn = { id: number; prompt: string; cards: Card[] };
type LogEntry = { id: number; label: string; status: LogStatus };

const STATUS_ICON: Record<LogStatus, { glyph: string; className: string; name: string }> = {
  running: { glyph: '', className: 'h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent', name: 'Running' },
  done: { glyph: '✓', className: 'text-emerald-400', name: 'Done' },
  failed: { glyph: '✕', className: 'text-red-400', name: 'Failed' },
};

export default function App() {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND);
  const contents = useRef<Content[]>([]); // full Gemini history, kept for follow-ups like "she"
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const input = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const recognition = useRef<any>(null);

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

  useEffect(() => {
    chrome.storage.local.get('backendUrl').then((saved) => {
      if (typeof saved.backendUrl === 'string' && saved.backendUrl) setBackendUrl(saved.backendUrl);
    });
  }, []);

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

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
  }

  const current = log.at(-1);
  const status = running ? (current?.label ?? 'Working') : notice || (turns.length ? 'Done.' : '');

  return (
    <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="mx-auto w-full max-w-3xl">
        <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-violet-300">Tabless</p>
        <h1 className="mb-6 text-4xl font-semibold tracking-tight">What do you need to do?</h1>

        <form
          className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 focus-within:border-violet-400/60"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <label htmlFor="request" className="sr-only">
            Your request
          </label>
          <textarea
            id="request"
            ref={input}
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about your email, your calendar or any site"
            className="min-h-14 flex-1 resize-none bg-transparent px-2 py-1 text-lg placeholder:text-zinc-500 focus:outline-none"
          />
          {SpeechRecognition && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={running}
              aria-pressed={listening}
              aria-label={listening ? 'Stop voice input' : 'Start voice input'}
              title={listening ? 'Stop voice input' : 'Speak your request'}
              className={`rounded-xl border px-3 py-2.5 disabled:opacity-40 ${
                listening ? 'animate-pulse border-violet-400 bg-violet-600 text-white' : 'border-white/15 text-zinc-200 hover:bg-white/10'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
          {running ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="rounded-xl border border-white/15 px-4 py-2 font-medium text-zinc-100 hover:bg-white/10"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim()}
              className="rounded-xl bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-500 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={running}
              onClick={() => send(chip)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-left text-sm text-zinc-300 hover:border-violet-400/60 hover:text-white disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
        </div>

        <p role="status" aria-live="polite" className="mt-5 flex min-h-6 items-center gap-2 text-sm text-zinc-400">
          {running && <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" aria-hidden="true" />}
          {status}
        </p>

        <div className="mt-2 space-y-8">
          {turns.map((turn) => (
            <section key={turn.id} aria-label={`Answer to: ${turn.prompt}`} className="space-y-3">
              <h2 className="text-sm text-zinc-400">{turn.prompt}</h2>
              {turn.cards.map((card, i) => (
                // Approval cards keep their edits when the final cards are inserted above them.
                <CardView key={card.type === 'approval' ? card.approvalId : i} card={card} />
              ))}
            </section>
          ))}
        </div>
      </main>

      <aside className="space-y-4 self-start lg:sticky lg:top-10">
        <details open className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <summary className="text-sm font-medium text-zinc-200">Activity log</summary>
          {log.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">Every step the agent takes shows up here.</p>
          ) : (
            <ol className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto text-sm">
              {log.map((entry) => {
                const icon = STATUS_ICON[entry.status];
                return (
                  <li key={entry.id} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                      <span className={icon.className}>{icon.glyph}</span>
                    </span>
                    <span className="sr-only">{icon.name}:</span>
                    <span className={`break-words ${entry.status === 'failed' ? 'text-red-300' : 'text-zinc-300'}`}>{entry.label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </details>

        <button
          type="button"
          onClick={async () =>
            setNotice((await showAgentTabs()) ? 'Expanded the Tabless tab group in the tab strip.' : 'The agent has not opened any tabs yet.')
          }
          className="w-full rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-white/10"
        >
          Show the tabs
        </button>

        <label className="block text-xs text-zinc-400">
          Backend URL
          <input
            type="url"
            value={backendUrl}
            onChange={(e) => {
              setBackendUrl(e.target.value);
              chrome.storage.local.set({ backendUrl: e.target.value });
            }}
            className="mt-1 w-full rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-200"
          />
        </label>
      </aside>
    </div>
  );
}
