import { z } from 'zod';

export const isHttpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u);

const str = z.string().default('');
// Links are rendered as hrefs, so anything that is not http(s) is dropped.
const link = str.transform((u) => (isHttpUrl(u) ? u : ''));
const sources = z
  .array(z.string())
  .default([])
  .transform((list) => list.filter(isHttpUrl));

export const cardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('answer'), title: str, text: z.string().min(1), sources }),
  z.object({
    type: z.literal('email'),
    sender: z.string().min(1),
    senderEmail: str,
    subject: str,
    time: str,
    body: str,
    complete: z.boolean().default(false),
    summary: str,
    url: link,
    warnings: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal('table'),
    title: str,
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.union([z.string(), z.number()]).transform(String))),
    sources,
  }),
  z.object({
    type: z.literal('calendar'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    events: z.array(z.object({ time: str, title: z.string().min(1) })).default([]),
    suggestedSlot: str,
    note: str,
  }),
  z.object({ type: z.literal('error'), message: z.string().min(1), recovery: str }),
]);

export type ModelCard = z.infer<typeof cardSchema>;

// A write the user must approve. Validated when Gemini proposes it and again,
// after the user's edits, when they click Approve.
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'use YYYY-MM-DDTHH:MM')
  .transform((s) => s.slice(0, 16));

export const actionSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('email'),
      to: z.email(),
      subject: z.string().trim().min(1).max(300),
      body: z.string().max(5000).default(''),
    }),
    z.object({
      kind: z.literal('calendar_event'),
      title: z.string().trim().min(1).max(300),
      start: localDateTime,
      end: localDateTime,
      location: z.string().max(300).default(''),
      details: z.string().max(3000).default(''),
    }),
  ])
  .refine((a) => a.kind !== 'calendar_event' || a.end > a.start, 'end must be after start');

export type Action = z.infer<typeof actionSchema>;
export type ApprovalCard = { type: 'approval'; approvalId: string; action: Action };
export type Card = ModelCard | ApprovalCard;
