// The agent's tabs: opened in the background, kept in one collapsed "Tabless"
// group, one tab per origin. Only tab ids recorded here are ever touched.
const GROUP_TITLE = 'Tabless';
type Store = { groupId?: number; tabs: Record<string, number> };

// Session storage, so reopening the New Tab page reuses the same tabs.
async function load(): Promise<Store> {
  const { agentTabs } = await chrome.storage.session.get('agentTabs');
  return (agentTabs as Store | undefined) ?? { tabs: {} };
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });
}

/** Opens `url` in the agent's tab for that origin, creating and grouping the tab if needed. */
export async function openAgentTab(url: string): Promise<number> {
  const origin = new URL(url).origin;
  const store = await load();
  const known = store.tabs[origin];
  if (known !== undefined) {
    try {
      await chrome.tabs.update(known, { url });
      return known;
    } catch {
      // The user closed it. Open a new one below.
    }
  }
  const tabId = (await chrome.tabs.create({ url, active: false })).id!;
  let groupId: number;
  try {
    groupId = await chrome.tabs.group({ tabIds: tabId, groupId: store.groupId });
  } catch {
    groupId = await chrome.tabs.group({ tabIds: tabId }); // the old group is gone
  }
  await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'purple', collapsed: true });
  await chrome.storage.session.set({ agentTabs: { groupId, tabs: { ...store.tabs, [origin]: tabId } } });
  return tabId;
}

export async function waitForLoad(tabId: number, signal: AbortSignal): Promise<void> {
  await sleep(400, signal); // let the navigation start before trusting "complete"
  while ((await chrome.tabs.get(tabId)).status !== 'complete') await sleep(250, signal);
}

/**
 * Runs `func` inside the tab. It is serialized, so it must be self-contained:
 * no imports, no outer variables, everything it needs passed through `args`.
 */
export async function runInTab<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args: Args,
): Promise<Awaited<Result>> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return injection?.result as Awaited<Result>;
}

/**
 * Calls `probe` every 500 ms until it returns a value, for up to `ms`.
 * We poll from this page, not inside the tab: timers in background tabs are throttled.
 */
export async function poll<T>(probe: () => Promise<T | null | undefined>, ms: number, signal: AbortSignal): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value != null) return value;
    if (Date.now() >= deadline) return undefined;
    await sleep(500, signal);
  }
}

/** Expands the "Tabless" group. Returns false if the agent has no tabs yet. */
export async function showAgentTabs(): Promise<boolean> {
  const { groupId } = await load();
  if (groupId === undefined) return false;
  try {
    await chrome.tabGroups.update(groupId, { collapsed: false });
    return true;
  } catch {
    return false;
  }
}
