/**
 * "My saved plans": several plans on this device only (localStorage). Nothing goes to our server,
 * and a location is never saved. Pure functions here; the page reads and writes localStorage.
 */
import { LANGUAGES, READING_LEVELS, type CarePlanResponse } from "./schema";
import type { Barrier } from "./resources";
import type { PlanResponse } from "./plan";

/** The old single saved session (before saved plans). Migrated into the list once. */
export const OLD_KEY = "atlas-session-v1";
export const STORE_KEY = "atlas-plans-v2";
export const NAME_MAX = 40;
export const DEFAULT_NAME = "My plan";

export type Session = {
  text: string;
  language: (typeof LANGUAGES)[number];
  level: (typeof READING_LEVELS)[number];
  care: CarePlanResponse | null;
  barriers: Barrier[];
  zip: string;
  note: string;
  plan: PlanResponse | null;
  done: Record<string, boolean>;
  removed: Record<string, boolean>;
  photoChecked?: boolean;
  /**
   * True when written by a version that saves only while the reading and plan still match these answers.
   * Older saves kept later edits beside an older result, so without it the results can't be trusted as current.
   */
  matched?: boolean;
};

export type SavedPlan = Session & { id: string; name: string; createdAt: string; savedAt: string };
export type Store = { v: 2; active: string | null; plans: SavedPlan[] };

export const emptyStore = (): Store => ({ v: 2, active: null, plans: [] });

/** A saved value only if it is still one of the choices (an old or edited save can hold anything), else the default. */
function oneOf<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

/** Only the fields we mean to keep. Anything else (a location above all) is dropped. */
export function pickSession(s: Session): Session {
  return {
    text: s.text ?? "", language: oneOf(LANGUAGES, s.language, "English"), level: oneOf(READING_LEVELS, s.level, "simple"), care: s.care ?? null,
    barriers: Array.isArray(s.barriers) ? s.barriers : [], zip: typeof s.zip === "string" ? s.zip : "", note: s.note ?? "",
    plan: s.plan ?? null, done: s.done ?? {}, removed: s.removed ?? {}, photoChecked: s.photoChecked ?? false,
    matched: s.matched === true,
  };
}

/** A name the person typed: trimmed, one line, not empty, not too long. */
export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return n || DEFAULT_NAME;
}

/** "My plan", then "My plan 2", "My plan 3"... so new plans never share a name by accident. */
export function nextName(store: Store): string {
  const taken = new Set(store.plans.map((p) => p.name));
  if (!taken.has(DEFAULT_NAME)) return DEFAULT_NAME;
  for (let i = 2; ; i++) if (!taken.has(`${DEFAULT_NAME} ${i}`)) return `${DEFAULT_NAME} ${i}`;
}

function parseStore(raw: string | null): Store | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v?.v !== 2 || !Array.isArray(v.plans)) return null;
    const plans: SavedPlan[] = v.plans
      .filter((p: SavedPlan) => p && typeof p.id === "string" && (p.care || p.plan))
      .map((p: SavedPlan) => ({ ...pickSession(p), id: p.id, name: cleanName(String(p.name ?? "")), createdAt: String(p.createdAt ?? p.savedAt ?? ""), savedAt: String(p.savedAt ?? "") }));
    const active = plans.some((p) => p.id === v.active) ? v.active : null;
    return { v: 2, active, plans };
  } catch {
    return null;
  }
}

/**
 * Reads the list. If there is no list yet but there is an old single saved session, it becomes the
 * first saved plan and opens. `migrated` tells the caller to remove the old key.
 */
export function loadStore(rawStore: string | null, rawOld: string | null, newId: string): { store: Store; migrated: boolean } {
  const store = parseStore(rawStore);
  if (store) return { store, migrated: rawOld != null };
  if (rawOld) {
    try {
      const old = JSON.parse(rawOld) as Session & { savedAt?: string };
      if (old && (old.care || old.plan)) {
        const at = old.savedAt ?? new Date(0).toISOString();
        return { store: { v: 2, active: newId, plans: [{ ...pickSession(old), id: newId, name: DEFAULT_NAME, createdAt: at, savedAt: at }] }, migrated: true };
      }
    } catch {}
    return { store: emptyStore(), migrated: true };
  }
  return { store: emptyStore(), migrated: false };
}

/** Saves the current session into the open plan, or into a new plan when none is open. */
export function saveSession(store: Store, s: Session, now: string, newId: string): Store {
  const data = pickSession(s);
  const at = store.plans.findIndex((p) => p.id === store.active);
  if (at === -1) {
    const plan: SavedPlan = { ...data, id: newId, name: nextName(store), createdAt: now, savedAt: now };
    return { v: 2, active: newId, plans: [...store.plans, plan] };
  }
  if (JSON.stringify(pickSession(store.plans[at])) === JSON.stringify(data)) return store; // nothing changed: keep its date
  const plans = store.plans.slice();
  plans[at] = { ...plans[at], ...data, savedAt: now };
  return { ...store, plans };
}

export function renamePlan(store: Store, id: string, name: string): Store {
  return { ...store, plans: store.plans.map((p) => (p.id === id ? { ...p, name: cleanName(name) } : p)) };
}

export function deletePlan(store: Store, id: string): Store {
  return { v: 2, active: store.active === id ? null : store.active, plans: store.plans.filter((p) => p.id !== id) };
}

export function openPlan(store: Store, id: string): Store {
  return store.plans.some((p) => p.id === id) ? { ...store, active: id } : store;
}

/** Leaves the open plan saved as it is; the next thing read becomes a new plan. */
export function closePlan(store: Store): Store {
  return { ...store, active: null };
}

/**
 * A fresh read (the paste box or a new photo) while a saved plan is open starts a new plan, so reading
 * Dad's paper never overwrites Mom's. Re-reading the same text (simpler, a corrected photo reading,
 * another language) stays in the open plan.
 */
export function readStartsNewPlan(r: { openPlanHasPaper: boolean; fresh: boolean; isPhoto: boolean; sameText: boolean }): boolean {
  if (!r.openPlanHasPaper || !r.fresh) return false;
  return r.isPhoto || !r.sameText;
}

/** Newest first, for the list. */
export function listPlans(store: Store): SavedPlan[] {
  return store.plans.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Progress shown in the list: steps checked off out of the steps still in the plan. */
export function progress(p: SavedPlan): { done: number; total: number } {
  const items = (p.care?.items ?? []).filter((i) => !p.removed[i.id]);
  return { done: items.filter((i) => p.done[i.id]).length, total: items.length };
}
