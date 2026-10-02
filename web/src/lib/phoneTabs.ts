/**
 * Phone tabs for the "Try it" section. On phones the three step cards become three tabs so the
 * page is not one long scroll. Pure logic only, so it can be tested without a browser.
 */

export type Tab = 1 | 2 | 3;
export const TABS: readonly Tab[] = [1, 2, 3];

export type FlowState = {
  /** A paper has been read (Step 1 has a result). */
  hasCare: boolean;
  /** A plan exists (Step 3 has something to show). */
  hasPlan: boolean;
};

export type TabInfo = {
  tab: Tab;
  available: boolean;
  /** Step finished: same rule as the check in each step's header. */
  done: boolean;
  /** Short reason shown when the tab is not available yet. */
  why: string | null;
};

/**
 * Step 2 is always open: the paper is optional ("optional, but it makes the plan yours"), and today
 * the person can pick barriers and make a plan without one. Step 3 needs a plan.
 */
export function tabInfo(s: FlowState): Record<Tab, TabInfo> {
  return {
    1: { tab: 1, available: true, done: s.hasCare, why: null },
    2: { tab: 2, available: true, done: s.hasPlan, why: null },
    3: { tab: 3, available: s.hasPlan, done: s.hasPlan, why: s.hasPlan ? null : "Make your plan in step 2 first" },
  };
}

/** The tab to show: the chosen one if it is open, otherwise the nearest open tab before it. */
export function shownTab(chosen: Tab, s: FlowState): Tab {
  const info = tabInfo(s);
  for (let t = chosen; t >= 1; t--) if (info[t as Tab].available) return t as Tab;
  return 1;
}

/**
 * Where a person lands when their saved session comes back: the furthest step they reached.
 * A saved plan opens the plan; a saved paper with no plan opens "your needs" (their next step).
 */
export function restoredTab(s: FlowState): Tab {
  if (s.hasPlan) return 3;
  if (s.hasCare) return 2;
  return 1;
}

/** Arrow keys, Home and End move between open tabs and wrap around, skipping closed ones. */
export function keyTarget(current: Tab, key: string, s: FlowState): Tab | null {
  const info = tabInfo(s);
  const open = TABS.filter((t) => info[t].available);
  if (open.length === 0) return null;
  if (key === "Home") return open[0];
  if (key === "End") return open[open.length - 1];
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (step === 0) return null;
  const at = open.indexOf(current);
  if (at === -1) return open[0];
  return open[(at + step + open.length) % open.length];
}
