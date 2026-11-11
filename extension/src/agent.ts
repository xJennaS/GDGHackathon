import { z } from 'zod';
import { cardSchema, type Card } from './cards';
import { groundEmail, tools } from './tools';

const MAX_STEPS = 8;
const TOOL_TIMEOUT_MS = 20_000;
const BACKEND_TIMEOUT_MS = 60_000;
const DEMO_TOKEN: string | undefined = import.meta.env.VITE_DEMO_TOKEN;

type FunctionCall = { id?: string; name?: string; args?: Record<string, unknown> };
type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: FunctionCall;
  functionResponse?: { id?: string; name?: string; response: Record<string, unknown> };
};
// Model turns are stored exactly as the backend returned them (they carry
// thoughtSignature fields Gemini needs back unchanged), so never rebuild one.
export type Content = { role?: string; parts?: Part[] };

export type LogStatus = 'running' | 'done' | 'failed';
export type RunOptions = {
  backendUrl: string;
  signal: AbortSignal;
  log(label: string): number;
  update(id: number, status: LogStatus, label: string): void;
  onApproval(card: Card): void;
};

export function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) {
    return 'Invalid arguments: ' + e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
  }
  if (e instanceof DOMException && e.name === 'TimeoutError') return 'Timed out.';
  return e instanceof Error ? e.message : String(e);
}

// Rejects as soon as the signal aborts, even if the promise itself never settles.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}

const wrapUntrusted = (data: unknown) =>
  `<<<UNTRUSTED_DATA\n${JSON.stringify(data).replaceAll('UNTRUSTED_DATA>>>', '')}\nUNTRUSTED_DATA>>>`;

async function callBackend(contents: Content[], backendUrl: string, signal: AbortSignal): Promise<Content> {
  const base = backendUrl.trim().replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/api/agent/step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(DEMO_TOKEN ? { 'x-demo-token': DEMO_TOKEN } : {}) },
      body: JSON.stringify({
        contents,
        today: new Date().toLocaleDateString('en-CA'), // local YYYY-MM-DD
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(BACKEND_TIMEOUT_MS)]),
    });
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Can't reach the backend at ${base}. Is it running?`);
    throw e;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Backend returned HTTP ${res.status}.`);
  return body as Content;
}

function parseCards(args: Record<string, unknown> | undefined): Card[] {
  const raw = Array.isArray(args?.cards) ? args.cards : [];
  const cards: Card[] = [];
  let dropped = 0;
  for (const item of raw) {
    const parsed = cardSchema.safeParse(item);
    if (parsed.success) cards.push(parsed.data.type === 'email' ? groundEmail(parsed.data) : parsed.data);
    else dropped++;
  }
  if (dropped || !raw.length) {
    cards.push({
      type: 'error',
      message: dropped ? `${dropped} card(s) from Gemini were invalid and were dropped.` : 'Gemini returned no cards.',
      recovery: 'Try rephrasing the request.',
    });
  }
  return cards;
}

/** Runs one user request to completion. Appends to `contents`, or leaves it untouched on failure. */
export async function runAgent(prompt: string, contents: Content[], opts: RunOptions): Promise<Card[]> {
  const { signal, log, update } = opts;
  const start = contents.length;
  const failures: string[] = [];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const runTool = async (call: FunctionCall): Promise<Record<string, unknown>> => {
    const tool = tools[call.name ?? ''];
    const id = log(tool?.start ?? `Unknown tool: ${call.name}`);
    try {
      if (!tool) throw new Error(`Unknown tool: ${call.name}`);
      const toolSignal = AbortSignal.any([signal, AbortSignal.timeout(TOOL_TIMEOUT_MS)]);
      const out = await abortable(tool.run(call.args, { signal: toolSignal, timezone, onApproval: opts.onApproval }), toolSignal);
      update(id, 'done', out.label);
      return out.untrusted ? { untrusted_data: wrapUntrusted(out.result) } : out.result;
    } catch (e) {
      if (signal.aborted) {
        update(id, 'failed', 'Cancelled');
        throw e;
      }
      const message = errorMessage(e);
      update(id, 'failed', `${call.name} failed: ${message}`);
      failures.push(`${call.name}: ${message}`);
      return { error: message };
    }
  };

  // Hard rule: a failed tool always surfaces as an error card, whatever Gemini wrote.
  const withFailures = (cards: Card[]): Card[] =>
    failures.length && !cards.some((c) => c.type === 'error')
      ? [...cards, { type: 'error', message: `A tool failed. ${failures.join(' | ')}`, recovery: 'Check the activity log, then try again.' }]
      : cards;

  contents.push({ role: 'user', parts: [{ text: prompt }] });
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const id = log('Asking Gemini');
      let content: Content;
      try {
        content = await callBackend(contents, opts.backendUrl, signal);
      } catch (e) {
        update(id, 'failed', signal.aborted ? 'Cancelled' : 'Gemini request failed');
        throw e;
      }
      contents.push(content);
      const calls = (content.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
      const names = calls.map((c) => c.name).filter((n) => n !== 'render_cards');
      update(id, 'done', names.length ? `Gemini asked for ${names.join(', ')}` : 'Gemini wrote the answer');

      if (!calls.length) {
        const text = (content.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
        return withFailures([
          text ? { type: 'answer', title: '', text, sources: [] } : { type: 'error', message: 'Gemini returned an empty reply.', recovery: 'Try again.' },
        ]);
      }

      const responses: Part[] = [];
      let final: Card[] | undefined;
      for (const call of calls) {
        let response: Record<string, unknown>;
        if (call.name === 'render_cards') {
          final = parseCards(call.args);
          response = { status: 'rendered' };
        } else {
          response = await runTool(call);
        }
        responses.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response } });
      }
      contents.push({ role: 'user', parts: responses });
      if (final) {
        // Close the turn with a model message so the next user message keeps roles alternating.
        contents.push({ role: 'model', parts: [{ text: 'Cards shown to the user.' }] });
        return withFailures(final);
      }
    }
    throw new Error(`Stopped after ${MAX_STEPS} steps without a final answer.`);
  } catch (e) {
    contents.length = start; // drop the half-finished turn so the history stays valid
    throw e;
  }
}
