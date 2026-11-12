import { useEffect, useState } from 'react';
import { errorMessage } from './agent';
import { isHttpUrl, type Action, type ApprovalCard as ApprovalCardData, type Card } from './cards';
import { approve, dismiss } from './tools';
import { Button, Card as SurfaceCard, Icon, StatusPill } from './components/ui';

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <nav className="source-list" aria-label="Sources">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="source-link">
          {sourceHostname(url)}
        </a>
      ))}
    </nav>
  );
}

function CardHeader({ icon, title, status }: { icon: 'mail' | 'calendar' | 'table' | 'shield' | 'error' | 'sparkle'; title: string; status?: string }) {
  return (
    <header className="card-header">
      <span className="card-icon"><Icon name={icon} /></span>
      <h3 className="card-heading">{title}</h3>
      {status && <span className="source-status">{status}</span>}
    </header>
  );
}

function EmailCard({ card, onReply }: { card: Extract<Card, { type: 'email' }>; onReply?(): void }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => speechSynthesis.cancel(), []);

  function toggleSpeech() {
    speechSynthesis.cancel();
    if (speaking) return;
    const intro = card.complete ? 'Email' : 'Preview of an email';
    const utterance = new SpeechSynthesisUtterance(`${intro} from ${card.sender}. Subject: ${card.subject}. ${card.body || card.summary}`);
    utterance.onend = utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <SurfaceCard>
      <CardHeader icon="mail" title={card.subject || '(no subject)'} status={card.complete ? 'Full message' : 'Preview only'} />
      <div className="flex items-center gap-3">
        <span className="email-avatar" aria-hidden="true">{card.sender.trim().charAt(0).toUpperCase() || '?'}</span>
        <div className="min-w-0">
          <p className="m-0 text-sm">{card.sender}{card.senderEmail ? <span className="card-muted"> &lt;{card.senderEmail}&gt;</span> : null}</p>
          <p className="m-0 text-xs card-muted">{card.time}</p>
        </div>
      </div>
      {card.warnings.map((warning) => (
        <p key={warning} className="warning-box"><span aria-hidden="true">⚠ </span>{warning}</p>
      ))}
      {card.summary && <div className="inset"><p className="inset-label">Summary</p><p className="m-0 card-text">{card.summary}</p></div>}
      {card.body && (
        <div tabIndex={0} role="group" aria-label={card.complete ? 'Email body' : 'Email preview'} className="inset max-h-64 overflow-y-auto whitespace-pre-wrap">
          <p className="inset-label">{card.complete ? 'Message' : 'Preview'}</p>
          <p className="m-0 card-text">{card.body}</p>
        </div>
      )}
      {!card.complete && <p className="mt-3 mb-0 text-sm card-muted">Only the available preview was read.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="tonal" onClick={toggleSpeech} aria-pressed={speaking}>{speaking ? 'Stop reading' : 'Read aloud'}</Button>
        {card.url && <a className="ui-button ui-button-outlined" href={card.url} target="_blank" rel="noreferrer">Open original</a>}
        {onReply && <Button type="button" onClick={onReply}>Reply</Button>}
      </div>
    </SurfaceCard>
  );
}

function CalendarCard({ card }: { card: Extract<Card, { type: 'calendar' }> }) {
  const [year, month, day] = card.date.split('-').map(Number);
  const title = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const calendarUrl = `https://calendar.google.com/calendar/r/day/${year}/${month}/${day}`;
  return (
    <SurfaceCard>
      <CardHeader icon="calendar" title={title} status="Not verified" />
      <p className="warning-box mt-0">Availability could not be fully verified from events visible in your calendar.</p>
      {card.events.length ? (
        <ul className="mt-3 divide-y divide-[var(--outline)]/30">
          {card.events.map((event, index) => (
            <li key={`${event.time}-${index}`} className="flex flex-wrap gap-x-5 gap-y-1 py-3 text-sm">
              <span className="w-36 shrink-0 card-muted">{event.time || 'All day'}</span>
              <span>{event.title}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 card-text">No events visible on this day.</p>}
      {card.suggestedSlot && <p className="inset"><span className="inset-label">Suggested slot</span><br />{card.suggestedSlot}</p>}
      {card.note && <p className="card-text">{card.note}</p>}
      <p className="mt-4 mb-0 text-sm card-muted">Based on events visible in your calendar. <a className="text-primary underline" href={calendarUrl} target="_blank" rel="noreferrer">Open calendar</a></p>
    </SurfaceCard>
  );
}

const fieldClass = 'mt-1 w-full rounded-[14px] border border-outline bg-surface px-3 py-2 text-sm text-on-surface disabled:opacity-60';

function Field(props: { label: string; value: string; type?: string; rows?: number; disabled: boolean; onChange(value: string): void }) {
  const { label, rows, onChange, ...rest } = props;
  return (
    <label className="field">
      {label}
      {rows ? (
        <textarea rows={rows} className={fieldClass} {...rest} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={fieldClass} {...rest} onChange={(event) => onChange(event.target.value)} />
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
      onChange={(value) => setAction((previous) => ({ ...previous, [key]: value }) as Action)}
      {...extra}
    />
  );

  async function onApprove() {
    try {
      await approve(card.approvalId, action);
      setState('opened');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  const steps = ['Proposed', 'Approved', 'Opened', 'Completed'];
  const activeStep = state === 'opened' ? 2 : 0;

  return (
    <SurfaceCard className="approval-card">
      <CardHeader icon="shield" title={action.kind === 'email' ? 'Review email draft' : 'Review calendar event'} status="Approval needed" />
      <div className="stepper" aria-label={`Approval status: ${state === 'pending' ? 'Proposed' : state === 'opened' ? 'Opened' : 'Cancelled'}`}>
        {steps.map((step, index) => (
          <span key={step} className={`stepper-step ${index <= activeStep ? 'done' : ''}`}>
            {index ? <span aria-hidden="true">→</span> : null}{step}
          </span>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
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
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!locked && (
          <>
            <Button type="button" onClick={onApprove}>Approve and open in {app}</Button>
            <Button type="button" variant="text" onClick={() => { dismiss(card.approvalId); setState('dismissed'); }}>Cancel</Button>
          </>
        )}
        <p role="status" aria-live="polite" className="m-0 text-sm card-muted">
          {state === 'pending' && `Nothing has been ${action.kind === 'email' ? 'sent' : 'created'}. Edit if needed, then approve.`}
          {state === 'opened' && `Opened in ${app}: review and ${action.kind === 'email' ? 'send' : 'save'}.`}
          {state === 'dismissed' && 'Cancelled. Nothing was opened.'}
        </p>
      </div>
    </SurfaceCard>
  );
}

export function CardView({ card, onReply, onRetry }: { card: Card; onReply?(): void; onRetry?(): void }) {
  switch (card.type) {
    case 'answer':
      return (
        <SurfaceCard>
          <CardHeader icon="sparkle" title={card.title || 'Answer'} />
          <p className="m-0 whitespace-pre-wrap card-text">{card.text}</p>
          <Sources urls={card.sources} />
        </SurfaceCard>
      );
    case 'email':
      return <EmailCard card={card} onReply={onReply} />;
    case 'table':
      return (
        <SurfaceCard>
          <CardHeader icon="table" title={card.title || 'Comparison'} />
          <div className="table-wrap" tabIndex={0} role="region" aria-label={card.title || 'Comparison table'}>
            <table className="data-table">
              <thead><tr>{card.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
              <tbody>
                {card.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {card.columns.map((_, columnIndex) => {
                      const cell = row[columnIndex] ?? '';
                      return <td key={columnIndex}>{isHttpUrl(cell) ? <a className="text-primary underline" href={cell} target="_blank" rel="noreferrer">{sourceHostname(cell)}</a> : cell}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Sources urls={card.sources} />
        </SurfaceCard>
      );
    case 'calendar':
      return <CalendarCard card={card} />;
    case 'approval':
      return <ApprovalCard card={card} />;
    case 'error':
      return (
        <SurfaceCard className="error-card" role="alert">
          <CardHeader icon="error" title="Something went wrong" status="Error" />
          <p className="m-0 whitespace-pre-wrap card-text">{card.message}</p>
          {card.recovery && <p className="mt-2 mb-0 card-muted">{card.recovery}</p>}
          {onRetry && <Button type="button" className="mt-4" variant="outlined" onClick={onRetry}>Retry</Button>}
        </SurfaceCard>
      );
    default:
      return null;
  }
}
