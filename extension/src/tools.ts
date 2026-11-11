import { z } from 'zod';
import { GMAIL } from './adapters/gmail-selectors';
import { actionSchema, isHttpUrl, type Action, type Card, type ModelCard } from './cards';
import { openAgentTab, poll, runInTab, sleep, waitForLoad } from './tabs';

export type ToolContext = { signal: AbortSignal; timezone: string; onApproval(card: Card): void };
// untrusted: the result holds web or email content and is wrapped in delimiters before Gemini sees it.
export type ToolOutput = { result: Record<string, unknown>; label: string; untrusted?: boolean };
export type Tool = { start: string; run(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutput> };

// Args are validated with Zod before the tool body runs.
function tool<S extends z.ZodType>(
  start: string,
  schema: S,
  run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutput>,
): Tool {
  return { start, run: (raw, ctx) => run(schema.parse(raw ?? {}), ctx) };
}

const PAGE_WAIT_MS = 15_000;

// ponytail: naive phrase match for prompt injection; it only adds a warning.
// Swap in a classifier if false negatives matter.
const INJECTION =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|prompts?|rules)\b|\b(you are|as) an? (ai|llm|language model)\b|\bsystem prompt\b|\b(ai|llm) (assistant|agent)s?\s*[,:]/i;
const INJECTION_WARNING = 'This content contains text that looks like instructions aimed at an AI assistant. They were ignored.';

// A few seconds on the wrong host means the site redirected us to a sign-in page.
function onHost(host: string, expected: string, started: number, site: string): boolean {
  if (host === expected) return true;
  if (Date.now() - started > 4000) {
    throw new Error(`${site} redirected to ${host}. Sign in to ${site} in this Chrome profile, then try again.`);
  }
  return false;
}

// ---- Gmail ----------------------------------------------------------------

type InboxRow = { id: string; sender: string; senderEmail: string; subject: string; snippet: string; time: string; unread: boolean };
type Thread = { sender: string; senderEmail: string; subject: string; date: string; body: string; url: string; complete: boolean; warnings: string[] };

// What the tools actually read, used to ground email cards in real data.
let inboxRows: InboxRow[] = [];
const threadsRead = new Map<string, Thread>();

// Runs inside the Gmail tab. Self-contained: see runInTab.
function extractInbox(sel: typeof GMAIL.inbox, max: number): { host: string; rows: InboxRow[] } {
  const first = (root: ParentNode, selectors: string[]) => {
    for (const s of selectors) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  let rows: Element[] = [];
  for (const s of sel.row) {
    const all = [...document.querySelectorAll(s)];
    const visible = all.filter((r) => r.checkVisibility());
    rows = visible.length ? visible : all;
    if (rows.length) break;
  }
  return {
    host: location.host,
    rows: rows.slice(0, max).map((row) => {
      const sender = first(row, sel.sender);
      const time = first(row, sel.time);
      const idEl = first(row, sel.threadId);
      let id = idEl?.getAttribute('data-legacy-thread-id') ?? '';
      if (!id) {
        const decimal = /thread-f:(\d+)/.exec(idEl?.getAttribute('data-thread-id') ?? '');
        if (decimal) id = BigInt(decimal[1]).toString(16);
      }
      return {
        id,
        sender: sender?.getAttribute('name') || text(sender),
        senderEmail: sender?.getAttribute('email') ?? '',
        subject: text(first(row, sel.subject)),
        snippet: text(first(row, sel.snippet)).replace(/^[\s\-–—]+/, ''),
        time: time?.getAttribute('title') || text(time),
        unread: row.classList.contains(sel.unreadClass),
      };
    }),
  };
}

// Fallback: Gmail's Atom feed, fetched from inside the Gmail tab (same origin). Unread mail only.
async function inboxFromFeed(tabId: number, max: number): Promise<InboxRow[]> {
  const xml = await runInTab(
    tabId,
    async (path: string) => {
      const res = await fetch(path, { credentials: 'include' });
      return res.ok ? res.text() : '';
    },
    [GMAIL.feedPath],
  ).catch(() => '');
  const feed = new DOMParser().parseFromString(xml || '<feed/>', 'application/xml');
  return [...feed.querySelectorAll('entry')].slice(0, max).map((entry) => {
    const get = (s: string) => entry.querySelector(s)?.textContent?.trim() ?? '';
    const href = entry.querySelector('link')?.getAttribute('href') ?? '';
    return {
      id: /message_id=([0-9a-f]+)/i.exec(href)?.[1] ?? '',
      sender: get('author > name'),
      senderEmail: get('author > email'),
      subject: get('title'),
      snippet: get('summary'),
      time: get('issued'),
      unread: true,
    };
  });
}

// Runs inside the Gmail tab. Self-contained: see runInTab. Returns null until the thread has rendered.
function extractThread(sel: typeof GMAIL.thread, id: string, lenient: boolean) {
  const first = (root: ParentNode, selectors: string[]) => {
    for (const s of selectors) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const subject = first(document, sel.subject);
  let bodies: HTMLElement[] = [];
  for (const s of sel.body) {
    const all = [...document.querySelectorAll<HTMLElement>(s)];
    const visible = all.filter((b) => b.checkVisibility());
    bodies = visible.length ? visible : all;
    if (bodies.length) break;
  }
  // Guard against reading the previously open thread while Gmail swaps views.
  const onThread =
    location.hash.includes(id) ||
    subject?.getAttribute('data-legacy-thread-id') === id ||
    (lenient && /^#[^/]+\/.+/.test(location.hash));
  if (!subject || !bodies.length || !onThread) return null;
  const bodyEl = bodies[bodies.length - 1]; // latest message in the thread
  const message = bodyEl.closest(sel.message.join(',')) ?? document;
  const sender = first(message, sel.sender);
  const date = first(message, sel.date);
  const body = (bodyEl.innerText || bodyEl.textContent || '').trim();
  return {
    sender: sender?.getAttribute('name') || text(sender),
    senderEmail: sender?.getAttribute('email') ?? '',
    subject: text(subject),
    date: date?.getAttribute('title') || text(date),
    body: body.slice(0, 8000),
    complete: body.length <= 8000 && !first(document, sel.clipped),
  };
}

/** Rewrites an email card from what the tools read, so it never shows text Gemini made up. */
export function groundEmail(card: Extract<ModelCard, { type: 'email' }>): Extract<ModelCard, { type: 'email' }> {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const thread = threadsRead.get(card.url) ?? [...threadsRead.values()].find((t) => same(t.subject, card.subject));
  if (thread) {
    return {
      ...card,
      sender: thread.sender || card.sender,
      senderEmail: thread.senderEmail,
      subject: thread.subject,
      time: thread.date || card.time,
      body: thread.body,
      complete: thread.complete,
      url: thread.url,
      warnings: [...new Set([...thread.warnings, ...card.warnings])],
    };
  }
  const row = inboxRows.find((r) => (r.id && card.url === GMAIL.threadUrl(r.id)) || same(r.subject, card.subject));
  if (row) {
    return {
      ...card,
      sender: row.sender || card.sender,
      senderEmail: row.senderEmail,
      subject: row.subject,
      time: row.time || card.time,
      body: row.snippet,
      complete: false, // only the inbox snippet was read: shown as "Preview"
      url: row.id ? GMAIL.threadUrl(row.id) : GMAIL.inboxUrl,
    };
  }
  return {
    ...card,
    complete: false,
    url: card.url || GMAIL.inboxUrl,
    warnings: ['Unverified: this card could not be matched to an email the tools read.', ...card.warnings],
  };
}

// ---- Calendar -------------------------------------------------------------

// Runs inside the Calendar tab. Self-contained: see runInTab.
function extractCalendar() {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const main = document.querySelector<HTMLElement>('[role="main"]');
  const events = [
    ...new Set([...document.querySelectorAll('[data-eventid]')].map((e) => clean(e.textContent ?? '').slice(0, 300)).filter(Boolean)),
  ];
  return {
    host: location.host,
    loaded: !!main,
    events,
    // If no event elements matched, hand over the raw day view so nothing is silently missed.
    visibleText: events.length ? '' : clean(main?.innerText || main?.textContent || '').slice(0, 3000),
  };
}

// ---- Any page -------------------------------------------------------------

// Runs inside the page's tab. Self-contained: see runInTab.
function extractPage(maxChars: number) {
  const skip = 'nav,footer,script,style,noscript,template,svg,iframe,[hidden],[aria-hidden="true"]';
  const textOf = (root: Element) => {
    const parts: string[] = [];
    const walk = (node: Node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          parts.push(child.textContent ?? '');
        } else if (child.nodeType === 1) {
          const el = child as Element;
          if (el.matches(skip) || !el.checkVisibility()) continue;
          const block = !getComputedStyle(el).display.startsWith('inline');
          if (block) parts.push('\n');
          walk(el);
          if (block) parts.push('\n');
        }
      }
    };
    walk(root);
    return parts.join('').replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n[ \n]*/g, '\n').trim();
  };

  // Prefer the main content element, unless it is suspiciously empty.
  let root: Element = document.body;
  let text = '';
  for (const candidate of [document.querySelector('main'), document.querySelector('[role="main"]'), document.querySelector('article'), document.body]) {
    if (!candidate) continue;
    root = candidate;
    text = textOf(candidate);
    if (text.length >= 200) break;
  }

  const seen = new Set<string>();
  const long: { text: string; url: string }[] = [];
  const short: { text: string; url: string }[] = [];
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const label = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!/^https?:/.test(a.href) || label.length < 3 || seen.has(a.href) || a.closest('nav,footer')) continue;
    seen.add(a.href);
    // Headline-length links first: on link lists they are the stories, not the chrome.
    (label.length >= 20 ? long : short).push({ text: label.slice(0, 120), url: a.href });
  }

  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
    links: [...long, ...short].slice(0, 30),
  };
}

// ---- Approvals ------------------------------------------------------------

// approvalId -> kind, for approvals not yet used. Enforces "one approval, one write".
const pendingApprovals = new Map<string, Action['kind']>();

function writeUrl(action: Action): string {
  const q = encodeURIComponent;
  if (action.kind === 'email') {
    return `https://mail.google.com/mail/?view=cm&to=${q(action.to)}&su=${q(action.subject)}&body=${q(action.body)}`;
  }
  const stamp = (local: string) => `${local.replace(/[-:]/g, '')}00`; // 2026-11-12T14:00 -> 20261112T140000
  const ctz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(action.title)}` +
    `&dates=${stamp(action.start)}/${stamp(action.end)}&details=${q(action.details)}&location=${q(action.location)}&ctz=${q(ctz)}`
  );
}

/**
 * The only place a write URL is built or opened. Call it from the user's
 * Approve click, with the fields as the user edited them. Each id works once.
 */
export async function approve(approvalId: string, edited: unknown): Promise<void> {
  const kind = pendingApprovals.get(approvalId);
  if (!kind) throw new Error('This approval was already used.');
  const action = actionSchema.parse(edited); // invalid edits throw and leave the approval pending
  if (action.kind !== kind) throw new Error('This approval is for a different kind of action.');
  pendingApprovals.delete(approvalId);
  await chrome.tabs.create({ url: writeUrl(action), active: true });
}

export function dismiss(approvalId: string): void {
  pendingApprovals.delete(approvalId);
}

// ---- Tools ----------------------------------------------------------------

export const tools: Record<string, Tool> = {
  calendar_read_day: tool(
    'Opening Google Calendar',
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD') }),
    async ({ date }, { signal }) => {
      const [year, month, day] = date.split('-').map(Number);
      const url = `https://calendar.google.com/calendar/r/day/${year}/${month}/${day}`;
      const tabId = await openAgentTab(url);
      await waitForLoad(tabId, signal); // a reused tab still shows the previous day until it reloads
      const started = Date.now();
      const probe = async () => {
        const page = await runInTab(tabId, extractCalendar, []).catch(() => null);
        return page && onHost(page.host, 'calendar.google.com', started, 'Google Calendar') && page.loaded ? page : null;
      };
      if (!(await poll(probe, PAGE_WAIT_MS, signal))) throw new Error('Google Calendar did not load.');
      await sleep(1500, signal); // events render a moment after the grid
      const page = await probe();
      if (!page) throw new Error('Google Calendar did not load.');
      return {
        untrusted: true,
        label: page.events.length ? `Read ${page.events.length} calendar events for ${date}` : `Read calendar for ${date}: no events visible`,
        result: {
          date,
          url,
          events: page.events,
          ...(page.events.length ? {} : { visibleText: page.visibleText }),
          note: 'These are only the events visible in the Google Calendar day view. This does not verify availability.',
        },
      };
    },
  ),

  read_page: tool(
    'Opening the page',
    z.object({ url: z.string().refine(isHttpUrl, 'must be an http(s) URL') }),
    async ({ url }, { signal }) => {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const tabId = await openAgentTab(url);
      // Slow pages: stop waiting after 12 s and read what has rendered.
      await Promise.race([waitForLoad(tabId, signal), sleep(12_000, signal)]);
      let page = await runInTab(tabId, extractPage, [12_000]);
      if (page && page.text.length < 200) {
        await sleep(1500, signal); // apps that render after load
        page = await runInTab(tabId, extractPage, [12_000]);
      }
      if (!page) throw new Error(`Could not read ${host}.`);
      return {
        untrusted: true,
        label: `Read ${host}${page.truncated ? ' (truncated)' : ''}`,
        result: { ...page, ...(INJECTION.test(page.text) ? { warning: INJECTION_WARNING } : {}) },
      };
    },
  ),

  propose_action: tool('Preparing an approval', actionSchema, async (action, { onApproval }) => {
    const approvalId = crypto.randomUUID();
    pendingApprovals.set(approvalId, action.kind);
    onApproval({ type: 'approval', approvalId, action });
    return {
      label: action.kind === 'email' ? 'Drafted an email for your approval' : 'Drafted a calendar event for your approval',
      result: { approvalId, status: 'pending' },
    };
  }),

  gmail_list_inbox: tool(
    'Opening Gmail',
    z.object({ max: z.number().int().min(1).max(25).default(10) }),
    async ({ max }, { signal }) => {
      const tabId = await openAgentTab(GMAIL.inboxUrl);
      const started = Date.now();
      let rows = await poll(
        async () => {
          const page = await runInTab(tabId, extractInbox, [GMAIL.inbox, max]).catch(() => null); // still loading
          return page && onHost(page.host, GMAIL.host, started, 'Gmail') && page.rows.length ? page.rows : null;
        },
        PAGE_WAIT_MS,
        signal,
      );
      let source = 'inbox';
      if (!rows) {
        rows = await inboxFromFeed(tabId, max);
        source = 'unread feed (unread mail only)';
      }
      if (!rows.length) throw new Error('No inbox rows found. The inbox may be empty, or Gmail changed its page layout.');
      inboxRows = rows;
      return { untrusted: true, label: `Read ${rows.length} inbox rows`, result: { source, rows } };
    },
  ),

  gmail_read_thread: tool(
    'Opening the email',
    z.object({ id: z.string().regex(/^[0-9a-f]{8,32}$/i, 'must be an id returned by gmail_list_inbox') }),
    async ({ id }, { signal }) => {
      const url = GMAIL.threadUrl(id);
      const tabId = await openAgentTab(url);
      const started = Date.now();
      const read = await poll(
        () => runInTab(tabId, extractThread, [GMAIL.thread, id, Date.now() - started > 3000]).catch(() => null),
        PAGE_WAIT_MS,
        signal,
      );
      if (!read) throw new Error('Could not read that email. Gmail may be signed out, or it changed its page layout.');
      const thread: Thread = { ...read, url, warnings: INJECTION.test(read.body) ? [INJECTION_WARNING] : [] };
      threadsRead.set(url, thread);
      return { untrusted: true, label: `Read email from ${thread.sender || 'unknown sender'}`, result: thread };
    },
  ),
};
