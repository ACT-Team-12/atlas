/**
 * Deleting a saved plan from this device, checked rather than assumed.
 *
 * localStorage can refuse a write (storage disabled, private mode, quota) or be unavailable altogether. If the
 * delete is not actually on disk, a reload brings the plan (and the person's paper) back, so the screen must not
 * say it is gone. This writes the store without the plan and then reads it back.
 */
import type { Store } from "./savedPlans";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** True only when the stored copy under `key` no longer holds plan `id` (or holds nothing at all). */
export function persistDeletion(getStorage: () => Storage, key: string, next: Store, id: string): boolean {
  try {
    const storage = getStorage();
    storage.setItem(key, JSON.stringify(next));
    const raw = storage.getItem(key);
    if (raw === null) return true;
    const stored = JSON.parse(raw) as Partial<Store>;
    if (!Array.isArray(stored.plans)) return false;
    return !stored.plans.some((p) => p?.id === id);
  } catch {
    return false;
  }
}
