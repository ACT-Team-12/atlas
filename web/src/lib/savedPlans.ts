/**
 * "My saved plans": several plans on this device only (localStorage). Nothing goes to our server,
 * and a location is never saved. Pure functions here; the page reads and writes localStorage.
 */
import { LANGUAGES, READING_LEVELS, type CarePlanResponse } from "./schema";
import type { Barrier } from "./resources";
import type { PlanResponse } from "./plan";
import type { MeaningResult } from "./meaning";

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
  /**
   * The second check's verdicts for `care`, kept on this device so a reopened plan shows what was already checked
   * without sending anything again (the privacy page promises nothing is uploaded on reopen). `key` ties them to the
   * exact steps and language they were made for (checksKey); a mismatch drops them.
   */
  checks?: SavedChecks;
};

export type SavedChecks = { key: string; policy: string; byId: Record<string, MeaningResult> };

/**
 * The second check's rules (model, prompt, number checker, guards) as of this version. Bump it whenever any of them
 * changes: saved verdicts made under other rules are not restored, and their steps show as checked once (Codex review).
 */
export const CHECK_POLICY = "2026-10-05";

/**
 * The steps and language a set of check verdicts was made for: every field the check reads (id, title, explanation,
 * when, quote) plus the language. FNV-1a over that text: a fingerprint, not a secret.
 */
export function checksKey(items: { id: string; title?: string; plain_language?: string; when?: string; source_quote?: string }[], language?: string): string {
  const text = JSON.stringify([language ?? "", ...items.map((i) => [i.id, i.title ?? "", i.plain_language ?? "", i.when ?? "", i.source_quote ?? ""])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${items.length}:${h.toString(16)}`;
}

/** Saved verdicts only when every one has the shape the check returns; anything else is dropped, never trusted. */
function pickChecks(c: unknown): SavedChecks | undefined {
  if (!c || typeof c !== "object") return undefined;
  const { key, policy, byId } = c as { key?: unknown; policy?: unknown; byId?: unknown };
  if (typeof key !== "string" || policy !== CHECK_POLICY || !byId || typeof byId !== "object" || Array.isArray(byId)) return undefined;
  const out: Record<string, MeaningResult> = {};
  for (const [id, r] of Object.entries(byId as Record<string, unknown>)) {
    const m = r as Partial<MeaningResult> | null;
    if (!m || typeof m !== "object" || m.id !== id || typeof m.flagged !== "boolean" || typeof m.certified !== "boolean"
      || typeof m.numbers_ok !== "boolean" || !Array.isArray(m.unexpected_numbers) || !m.unexpected_numbers.every((n) => typeof n === "string")
      || !["same", "different", "unclear"].includes(m.model_verdict as string) || typeof m.what_differs !== "string") return undefined;
    // Certified means the second model said "same" and every number checked out (lib/meaning.ts): never more.
    if (m.certified && (m.flagged || m.model_verdict !== "same" || !m.numbers_ok)) return undefined;
    out[id] = { id, flagged: m.flagged, certified: m.certified, numbers_ok: m.numbers_ok, unexpected_numbers: m.unexpected_numbers, model_verdict: m.model_verdict as MeaningResult["model_verdict"], what_differs: m.what_differs };
  }
  return { key, policy, byId: out };
}

export type SavedPlan = Session & { id: string; name: string; createdAt: string; savedAt: string };
export type Store = { v: 2; active: string | null; plans: SavedPlan[] };

export const emptyStore = (): Store => ({ v: 2, active: null, plans: [] });

/** A saved value only if it is still one of the choices (an old or edited save can hold anything), else the default. */
function oneOf<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

/** Only the fields we mean to keep. Anything else (a location above all) is dropped. */
export function pickSession(s: Session): Session {
  const language = oneOf(LANGUAGES, s.language, "English");
  const level = oneOf(READING_LEVELS, s.level, "simple");
  // A replaced language or level means the saved results were made under other settings: never certify them as current.
  const replaced = language !== s.language || level !== s.level;
  const checks = pickChecks(s.checks);
  return {
    text: s.text ?? "", language, level, care: s.care ?? null,
    barriers: Array.isArray(s.barriers) ? s.barriers : [], zip: typeof s.zip === "string" ? s.zip : "", note: s.note ?? "",
    plan: s.plan ?? null, done: s.done ?? {}, removed: s.removed ?? {}, photoChecked: s.photoChecked ?? false,
    matched: s.matched === true && !replaced,
    ...(checks ? { checks } : {}),
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
  // Verdicts for steps that are no longer the plan's must not linger in the save (Codex review).
  if (!data.checks) delete plans[at].checks;
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
