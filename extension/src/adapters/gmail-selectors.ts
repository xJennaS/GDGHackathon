// Every Gmail selector lives here. Gmail's DOM is obfuscated and these were
// written without seeing a live page, so each list is tried in order until one
// matches. If extraction fails, fix it here from a sanitized outerHTML sample.
export const GMAIL = {
  host: 'mail.google.com',
  inboxUrl: 'https://mail.google.com/mail/u/0/#inbox',
  threadUrl: (id: string) => `https://mail.google.com/mail/u/0/#inbox/${id}`,
  // Same-origin Atom feed, used when no inbox rows can be read. Unread mail only.
  feedPath: '/mail/feed/atom',

  inbox: {
    row: ['tr.zA', 'div[role="main"] table[role="grid"] tr[role="row"]', 'div[role="main"] tr[jsmodel]'],
    unreadClass: 'zE',
    // The sender element carries `name` and `email` attributes.
    sender: ['.yW span[email]', '.yX span[email]', 'span[email]', '.yW', '.yX'],
    subject: ['.bog', '.y6 span[id]', '.y6'],
    snippet: ['.y2'],
    // Full date is in the `title` attribute.
    time: ['td.xW span[title]', '.xW span', 'td:last-child span[title]'],
    // `data-legacy-thread-id` is the hex id used in #inbox/<id>;
    // `data-thread-id` is "#thread-f:<decimal>" and is converted to hex.
    threadId: ['[data-legacy-thread-id]', '[data-thread-id]'],
  },

  thread: {
    // Also carries `data-legacy-thread-id`, which confirms the right thread is open.
    subject: ['h2.hP', 'h2[data-legacy-thread-id]', 'div[role="main"] h2'],
    message: ['div.adn', 'div[role="listitem"]'],
    body: ['div.a3s.aiL', 'div.a3s'],
    sender: ['span.gD[email]', 'h3 span[email]', 'span[email]'],
    date: ['span.g3[title]', 'span.g3'],
    // "[Message clipped] View entire message" link.
    clipped: ['a[href*="view=lg"]'],
  },
};
