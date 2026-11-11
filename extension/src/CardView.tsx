import { useEffect, useState } from 'react';
import { errorMessage } from './agent';
import { isHttpUrl, type Action, type ApprovalCard as ApprovalCardData, type Card } from './cards';
import { approve, dismiss } from './tools';

const shell = 'animate-fade-in rounded-2xl border border-white/10 bg-white/[0.04] p-5';
const linkClass = 'text-violet-300 underline underline-offset-2 hover:text-violet-200';

function sourceLabel(url: string): string {
  const u = new URL(url);
  const path = u.pathname === '/' ? '' : u.pathname;
  return (u.hostname.replace(/^www\./, '') + path).slice(0, 48);
}

function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
      <span>Sources:</span>
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className={linkClass}>
          {sourceLabel(u)}
        </a>
      ))}
    </p>
  );
}

const buttonClass = 'rounded-lg border border-white/15 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/10 disabled:opacity-40';

function EmailCard({ card }: { card: Extract<Card, { type: 'email' }> }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => speechSynthesis.cancel(), []);

  function toggleSpeech() {
    speechSynthesis.cancel(); // stops this card, or any other card that is reading
    if (speaking) return;
    const intro = card.complete ? 'Email' : 'Preview of an email';
    const utterance = new SpeechSynthesisUtterance(`${intro} from ${card.sender}. Subject: ${card.subject}. ${card.body || card.summary}`);
    utterance.onend = utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <article className={shell}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-zinc-300">
          <span className="font-semibold text-zinc-100">{card.sender}</span>
          {card.senderEmail && <span className="text-zinc-400"> &lt;{card.senderEmail}&gt;</span>}
        </p>
        <p className="text-xs text-zinc-400">{card.time}</p>
      </header>
      <h3 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold">
        {card.subject || '(no subject)'}
        {!card.complete && (
          <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-xs font-medium text-amber-200">Preview</span>
        )}
      </h3>
      {card.warnings.map((warning) => (
        <p key={warning} className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          <span aria-hidden="true">⚠ </span>
          {warning}
        </p>
      ))}
      {card.summary && <p className="mt-3 leading-relaxed text-zinc-200">{card.summary}</p>}
      {card.body && (
        <div
          tabIndex={0}
          role="group"
          aria-label={card.complete ? 'Email body' : 'Email preview'}
          className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-zinc-300"
        >
          {card.body}
        </div>
      )}
      {!card.complete && <p className="mt-2 text-xs text-zinc-400">Preview only. The full message was not read.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={toggleSpeech} aria-pressed={speaking} className={buttonClass}>
          {speaking ? 'Stop reading' : 'Read aloud'}
        </button>
        {card.url && (
          <a href={card.url} target="_blank" rel="noreferrer" className={buttonClass}>
            Open original
          </a>
        )}
      </div>
    </article>
  );
}

function CalendarCard({ card }: { card: Extract<Card, { type: 'calendar' }> }) {
  const [year, month, day] = card.date.split('-').map(Number);
  const title = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <article className={shell}>
      <h3 className="text-lg font-semibold">{title}</h3>
      {card.events.length ? (
        <ul className="mt-3 divide-y divide-white/10">
          {card.events.map((event, i) => (
            <li key={i} className="flex gap-4 py-2 text-sm">
              <span className="w-36 shrink-0 text-zinc-400">{event.time || 'All day'}</span>
              <span className="text-zinc-100">{event.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-zinc-300">No events visible on this day.</p>
      )}
      {card.suggestedSlot && (
        <p className="mt-3 rounded-xl border border-violet-400/40 bg-violet-400/10 px-3 py-2 text-sm text-violet-100">
          Suggested slot: <span className="font-medium">{card.suggestedSlot}</span>
        </p>
      )}
      {card.note && <p className="mt-3 text-sm leading-relaxed text-zinc-300">{card.note}</p>}
      <p className="mt-4 text-xs text-zinc-400">
        Based on events visible in your calendar.{' '}
        <a href={`https://calendar.google.com/calendar/r/day/${year}/${month}/${day}`} target="_blank" rel="noreferrer" className={linkClass}>
          Open calendar
        </a>
      </p>
    </article>
  );
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60';

function Field(props: { label: string; value: string; type?: string; rows?: number; disabled: boolean; onChange(value: string): void }) {
  const { label, rows, onChange, ...rest } = props;
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      {rows ? (
        <textarea rows={rows} className={fieldClass} {...rest} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={fieldClass} {...rest} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function ApprovalCard({ card }: { card: ApprovalCardData }) {
  const [action, setAction] = useState(card.action);
  const [state, setState] = useState<'pending' | 'opened' | 'dismissed'>('pending');
  const [error, setError] = useState('');
  const app = action.kind === 'email' ? 'Gmail' : 'Calendar';
  const locked = state !== 'pending';
  const field = (label: string, key: string, extra: { type?: string; rows?: number } = {}) => (
    <Field
      label={label}
      value={(action as Record<string, string>)[key]}
      disabled={locked}
      onChange={(value) => setAction((a) => ({ ...a, [key]: value }) as Action)}
      {...extra}
    />
  );

  async function onApprove() {
    try {
      await approve(card.approvalId, action); // the write URL opens only here
      setState('opened');
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <article className={`${shell} border-violet-400/50`}>
      <h3 className="text-lg font-semibold">
        Approval needed: {action.kind === 'email' ? 'email draft' : 'calendar event'}
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {action.kind === 'email' ? (
          <>
            {field('To', 'to', { type: 'email' })}
            {field('Subject', 'subject')}
            <div className="sm:col-span-2">{field('Message', 'body', { rows: 5 })}</div>
          </>
        ) : (
          <>
            <div className="sm:col-span-2">{field('Title', 'title')}</div>
            {field('Starts', 'start', { type: 'datetime-local' })}
            {field('Ends', 'end', { type: 'datetime-local' })}
            <div className="sm:col-span-2">{field('Location', 'location')}</div>
            <div className="sm:col-span-2">{field('Details', 'details', { rows: 3 })}</div>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!locked && (
          <>
            <button type="button" onClick={onApprove} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500">
              Approve and open in {app}
            </button>
            <button
              type="button"
              onClick={() => {
                dismiss(card.approvalId);
                setState('dismissed');
              }}
              className={buttonClass}
            >
              Dismiss
            </button>
          </>
        )}
        <p role="status" aria-live="polite" className="text-sm text-zinc-300">
          {state === 'pending' && `Nothing has been ${action.kind === 'email' ? 'sent' : 'created'}. Edit if needed, then approve.`}
          {state === 'opened' && `Opened in ${app}: review and ${action.kind === 'email' ? 'send' : 'save'}.`}
          {state === 'dismissed' && 'Dismissed. Nothing was opened.'}
        </p>
      </div>
    </article>
  );
}

export function CardView({ card }: { card: Card }) {
  switch (card.type) {
    case 'answer':
      return (
        <article className={shell}>
          {card.title && <h3 className="mb-2 text-lg font-semibold">{card.title}</h3>}
          <p className="whitespace-pre-wrap leading-relaxed text-zinc-200">{card.text}</p>
          <Sources urls={card.sources} />
        </article>
      );
    case 'email':
      return <EmailCard card={card} />;
    case 'table':
      return (
        <article className={shell}>
          {card.title && <h3 className="mb-3 text-lg font-semibold">{card.title}</h3>}
          <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={card.title || 'Table'}>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/15 text-zinc-400">
                  {card.columns.map((column, i) => (
                    <th key={i} scope="col" className="py-2 pr-4 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {card.rows.map((row, r) => (
                  <tr key={r} className="align-top">
                    {card.columns.map((_, c) => {
                      const cell = row[c] ?? '';
                      return (
                        <td key={c} className={`py-2 pr-4 ${c === 0 ? 'font-medium text-zinc-100' : 'text-zinc-300'}`}>
                          {isHttpUrl(cell) ? (
                            <a href={cell} target="_blank" rel="noreferrer" className={linkClass}>
                              {sourceLabel(cell)}
                            </a>
                          ) : (
                            cell
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Sources urls={card.sources} />
        </article>
      );
    case 'calendar':
      return <CalendarCard card={card} />;
    case 'approval':
      return <ApprovalCard card={card} />;
    case 'error':
      return (
        <article className={`${shell} border-red-400/40`} role="alert">
          <h3 className="mb-1 font-semibold text-red-300">Something went wrong</h3>
          <p className="whitespace-pre-wrap text-zinc-200">{card.message}</p>
          {card.recovery && <p className="mt-2 text-sm text-zinc-400">{card.recovery}</p>}
        </article>
      );
    default:
      return null;
  }
}
