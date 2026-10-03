/**
 * Deleted plans stay deleted across tabs.
 *
 * Saved plans live under one localStorage key, and each tab writes the whole store from its own in-memory copy. A tab
 * opened before a delete in another tab still holds the deleted plan, and its next write would put that plan (and the
 * person's paper) back on disk. So a delete first records the plan's id in a second key, and every write and every
 * load drops any plan whose id is recorded there. The list holds random plan ids only, never paper text or names, and
 * keeps the newest MAX_TOMBSTONES ids.
 *
 * Each tab also listens for `storage` events on that key: when another tab deletes the plan this tab has open, this
 * tab erases it from its screen the same way Clear does.
 */
import { persistDeletion } from "./persistDeletion";
import { STORE_KEY, type Store } from "./savedPlans";

export const TOMBSTONE_KEY = "atlas-deleted-v1";
export const MAX_TOMBSTONES = 200;
const MAX_ID = 200;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The recorded ids, newest last. Anything that is not a short string is ignored. */
export function parseTombstones(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_ID).slice(-MAX_TOMBSTONES);
  } catch {
    return [];
  }
}

/** Adds `id` as the newest entry and keeps the list bounded. */
export function addTombstone(list: string[], id: string): string[] {
  return [...list.filter((x) => x !== id), id].slice(-MAX_TOMBSTONES);
}

/** The deleted ids recorded on this device; empty when storage cannot be read. */
export function readTombstones(getStorage: () => Storage): Set<string> {
  try {
    return new Set(parseTombstones(getStorage().getItem(TOMBSTONE_KEY)));
  } catch {
    return new Set();
  }
}

/** `store` without deleted plans. `openWasDeleted` means the plan open in this tab was one of them. */
export function dropDeleted(store: Store, dead: ReadonlySet<string>): { store: Store; openWasDeleted: boolean } {
  const openWasDeleted = store.active !== null && dead.has(store.active);
  if (!store.plans.some((p) => dead.has(p.id)) && !openWasDeleted) return { store, openWasDeleted };
  return { store: { v: 2, active: openWasDeleted ? null : store.active, plans: store.plans.filter((p) => !dead.has(p.id)) }, openWasDeleted };
}

/**
 * Writes `next` to storage, minus any plan another tab deleted. Returns what was kept (the caller shows exactly that),
 * whether the write worked, and whether the plan open here was deleted elsewhere (the caller then erases its paper).
 */
export function saveStore(getStorage: () => Storage, next: Store): { store: Store; ok: boolean; openWasDeleted: boolean } {
  const r = dropDeleted(next, readTombstones(getStorage));
  try {
    getStorage().setItem(STORE_KEY, JSON.stringify(r.store));
    return { ...r, ok: true };
  } catch {
    return { ...r, ok: false };
  }
}

function markDeleted(getStorage: () => Storage, id: string): boolean {
  try {
    const s = getStorage();
    s.setItem(TOMBSTONE_KEY, JSON.stringify(addTombstone(parseTombstones(s.getItem(TOMBSTONE_KEY)), id)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes plan `id` on this device: records the tombstone first, then writes `next` (minus plans other tabs deleted)
 * and reads it back. Returns null when storage still holds the plan. If the tombstone could not be written first
 * (storage full), it is tried again once the smaller store is on disk.
 */
export function deleteOnDevice(getStorage: () => Storage, next: Store, id: string): { store: Store; openWasDeleted: boolean } | null {
  const marked = markDeleted(getStorage, id);
  const r = dropDeleted(next, readTombstones(getStorage));
  if (!persistDeletion(getStorage, STORE_KEY, r.store, id)) return null;
  if (!marked) markDeleted(getStorage, id);
  return r;
}

/**
 * Calls `onDeleted` with the full list of deleted ids whenever another tab records a delete. Returns the unsubscribe.
 * (A `storage` event only reaches the other tabs of this site, never the tab that wrote.)
 */
export function watchDeletions(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, onDeleted: (dead: Set<string>) => void): () => void {
  const handler = (e: Event) => {
    const { key, newValue } = e as StorageEvent;
    if (key !== TOMBSTONE_KEY) return;
    onDeleted(new Set(parseTombstones(newValue)));
  };
  target.addEventListener("storage", handler);
  return () => target.removeEventListener("storage", handler);
}
