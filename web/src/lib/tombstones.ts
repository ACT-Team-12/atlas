/**
 * Deleted plans stay deleted across tabs.
 *
 * Saved plans live under one localStorage key, and each tab writes the whole store from its own in-memory copy. A tab
 * opened before a delete in another tab still holds the deleted plan, and its next write would put that plan (and the
 * person's paper) back on disk. So a delete first records the plan's id in a second key, and every write and every
 * load drops any plan whose id is recorded there. The list holds random plan ids only, never paper text or names, and
 * keeps the newest MAX_TOMBSTONES ids.
 *
 * Two keys cannot be written atomically, and each tab sees the others' writes a moment late, so two races remain:
 * a stale tab can write a deleted plan back just after the delete, and two deletes at once can overwrite each other's
 * entry in the list. Neither is final. Each tab remembers every deleted id it has seen (DeletedPlans) and listens for
 * `storage` events: when the list loses an id it knows, it writes the id back; when the store comes back holding a
 * deleted plan, it writes the store again without it; and when the plan it has open is deleted elsewhere, it erases it
 * from its screen the same way Clear does. A page load also drops deleted plans and writes the cleaned store.
 */
import { persistDeletion } from "./persistDeletion";
import { loadStore, STORE_KEY, type Store } from "./savedPlans";

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

/** `store` without deleted plans. `openWasDeleted` means the plan open in this tab was one of them. */
export function dropDeleted(store: Store, dead: ReadonlySet<string>): { store: Store; openWasDeleted: boolean } {
  const openWasDeleted = store.active !== null && dead.has(store.active);
  if (!store.plans.some((p) => dead.has(p.id)) && !openWasDeleted) return { store, openWasDeleted };
  return { store: { v: 2, active: openWasDeleted ? null : store.active, plans: store.plans.filter((p) => !dead.has(p.id)) }, openWasDeleted };
}

/**
 * One tab's view of the deleted ids: what storage lists, plus every id this tab has seen deleted (so a list that lost
 * an entry to a concurrent write is put right again). Bounded like the stored list.
 */
export class DeletedPlans {
  private known: string[] = [];

  constructor(private readonly getStorage: () => Storage) {}

  private stored(): string[] | null {
    try {
      return parseTombstones(this.getStorage().getItem(TOMBSTONE_KEY));
    } catch {
      return null;
    }
  }

  private remember(ids: string[]) {
    for (const id of ids) if (!this.known.includes(id)) this.known = addTombstone(this.known, id);
  }

  /** Every deleted id known here: the stored list and this tab's own memory. */
  all(): Set<string> {
    const s = this.stored();
    if (s) this.remember(s);
    return new Set(this.known);
  }

  /**
   * Records `id` (and writes back any id this tab knows that the list lost). True only when a read-back of the list
   * holds `id`.
   */
  mark(id: string): boolean {
    this.remember([id]);
    return this.writeUnion();
  }

  /** Writes the stored list merged with this tab's memory; true when the read-back holds every id this tab knows. */
  private writeUnion(): boolean {
    try {
      const s = this.getStorage();
      let list = parseTombstones(s.getItem(TOMBSTONE_KEY));
      for (const id of this.known) if (!list.includes(id)) list = addTombstone(list, id);
      s.setItem(TOMBSTONE_KEY, JSON.stringify(list));
      const back = parseTombstones(s.getItem(TOMBSTONE_KEY));
      return this.known.every((id) => back.includes(id));
    } catch {
      return false;
    }
  }

  /** The stored list lost an id this tab knows (two deletes at once): write it back. True when something was restored. */
  repairList(): boolean {
    const s = this.stored();
    if (!s) return false;
    const lost = this.known.some((id) => !s.includes(id));
    this.remember(s);
    if (lost) this.writeUnion();
    return lost;
  }
}

/**
 * Writes `next` to storage, minus any deleted plan. Returns what was kept (the caller shows exactly that), whether the
 * write worked, and whether the plan open here was deleted elsewhere (the caller then erases its paper).
 */
export function saveStore(getStorage: () => Storage, deleted: DeletedPlans, next: Store): { store: Store; ok: boolean; openWasDeleted: boolean } {
  const r = dropDeleted(next, deleted.all());
  try {
    getStorage().setItem(STORE_KEY, JSON.stringify(r.store));
    return { ...r, ok: true };
  } catch {
    return { ...r, ok: false };
  }
}

/**
 * Deletes plan `id` on this device: records it in the deleted list first, then writes `next` (minus every deleted
 * plan) and reads it back. Returns null when storage still holds the plan. When the list could not be written first
 * (storage full), it is tried again once the smaller store is on disk; the delete itself already happened then, so it
 * is still reported as done, and this tab keeps the id and writes it back on the next storage event.
 */
export function deleteOnDevice(getStorage: () => Storage, deleted: DeletedPlans, next: Store, id: string): { store: Store; openWasDeleted: boolean } | null {
  const marked = deleted.mark(id);
  const r = dropDeleted(next, deleted.all());
  if (!persistDeletion(getStorage, STORE_KEY, r.store, id)) return null;
  if (!marked) deleted.mark(id);
  return r;
}

/** The store on disk holds a deleted plan (a stale tab wrote it back): write it again without. True when it did. */
export function repairStore(getStorage: () => Storage, deleted: DeletedPlans): boolean {
  try {
    const s = getStorage();
    const raw = s.getItem(STORE_KEY);
    if (!raw) return false;
    const onDisk = loadStore(raw, null, "unused").store;
    const r = dropDeleted(onDisk, deleted.all());
    if (r.store === onDisk) return false;
    s.setItem(STORE_KEY, JSON.stringify(r.store));
    return true;
  } catch {
    return false;
  }
}

/**
 * Listens for other tabs' writes (a `storage` event only reaches the other tabs of this site, never the writer):
 * a change to the deleted list repairs it if it lost an id and calls `onDeleted` with every deleted id; a change to the
 * store writes it again without any deleted plan. Returns the unsubscribe.
 */
export function watchDeletions(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  getStorage: () => Storage,
  deleted: DeletedPlans,
  onDeleted: (dead: Set<string>) => void,
): () => void {
  const handler = (e: Event) => {
    const { key } = e as StorageEvent;
    if (key === TOMBSTONE_KEY) {
      deleted.repairList();
      onDeleted(deleted.all());
    } else if (key === STORE_KEY) {
      repairStore(getStorage, deleted);
    }
  };
  target.addEventListener("storage", handler);
  return () => target.removeEventListener("storage", handler);
}
