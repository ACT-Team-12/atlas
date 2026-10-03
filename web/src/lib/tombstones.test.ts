import { describe, expect, it, vi } from "vitest";
import { addTombstone, deleteOnDevice, dropDeleted, MAX_TOMBSTONES, parseTombstones, readTombstones, saveStore, TOMBSTONE_KEY, watchDeletions } from "./tombstones";
import { deletePlan, emptyStore, loadStore, saveSession, STORE_KEY, type Session, type Store } from "./savedPlans";
import type { CarePlanResponse } from "./schema";

const paper = (who: string) => `Take 1 tablet of metformin by mouth 2 times a day. ${who}'s private paper.`;
const care = (text: string) => ({ source_text: text, items: [], stats: { grounded: 0, refused: 0, ms: 1 } }) as unknown as CarePlanResponse;
const session = (text: string): Session => ({ text, language: "English", level: "simple", care: care(text), barriers: [], zip: "", note: "", plan: null, done: {}, removed: {} });

/** One site's localStorage, shared by every tab. `refuse` makes every write throw (storage full or disabled). */
function sharedStorage() {
  const m = new Map<string, string>();
  const state = { refuse: false };
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (state.refuse) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      m.set(k, v);
    },
  };
  return { m, s, state };
}

/** Mom's plan (open) and Dad's plan, as saved before either tab deleted anything. */
function twoPlans(): Store {
  const a = saveSession(emptyStore(), session(paper("Mom")), "2026-10-01T00:00:00Z", "plan-mom");
  const b = saveSession({ ...a, active: null }, session(paper("Dad")), "2026-10-02T00:00:00Z", "plan-dad");
  return { ...b, active: "plan-mom" };
}

/** Each tab's in-memory copy, loaded from the shared storage the way the page loads it. */
function openTab(s: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }): Store {
  return dropDeleted(loadStore(s.getItem(STORE_KEY), null, "unused").store, readTombstones(() => s)).store;
}

describe("a plan deleted in one tab stays deleted in the others", () => {
  it("tab B, still holding the old list, saves a checkbox and the deleted plan does not come back", () => {
    const { m, s } = sharedStorage();
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(s);
    const tabB = openTab(s); // loaded before the delete

    expect(deleteOnDevice(() => s, deletePlan(tabA, "plan-mom"), "plan-mom")).not.toBeNull();

    // B ticks a step on its (stale) open plan: the whole store is written from B's memory.
    const r = saveStore(() => s, saveSession(tabB, { ...session(paper("Mom")), done: { "item-0": true } }, "2026-10-03T00:00:00Z", "unused"));
    const onDisk = m.get(STORE_KEY)!;
    expect(onDisk).not.toContain("plan-mom");
    expect(onDisk).not.toContain("Mom's private paper");
    expect(onDisk).toContain("plan-dad");
    expect(r.openWasDeleted).toBe(true); // B is told to erase the paper from its screen
    expect(r.store.active).toBeNull();
    expect(openTab(s).plans.map((p) => p.id)).toEqual(["plan-dad"]); // and a reload agrees
  });

  it("a delete in tab B does not write back a plan tab A already deleted", () => {
    const { m, s } = sharedStorage();
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(s);
    const tabB = openTab(s);
    expect(deleteOnDevice(() => s, deletePlan(tabA, "plan-mom"), "plan-mom")).not.toBeNull();
    const r = deleteOnDevice(() => s, deletePlan(tabB, "plan-dad"), "plan-dad");
    expect(r).not.toBeNull();
    expect(r!.store.plans).toEqual([]);
    expect(JSON.parse(m.get(STORE_KEY)!).plans).toEqual([]);
  });

  it("a page load drops a deleted plan an older tab wrote back", () => {
    const { s } = sharedStorage();
    s.setItem(TOMBSTONE_KEY, JSON.stringify(["plan-mom"]));
    s.setItem(STORE_KEY, JSON.stringify(twoPlans())); // written by a tab without this fix
    const loaded = openTab(s);
    expect(loaded.plans.map((p) => p.id)).toEqual(["plan-dad"]);
    expect(loaded.active).toBeNull();
  });

  it("tab B, with the deleted plan open, hears the storage event and erases its screen", () => {
    const { m, s } = sharedStorage();
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(s);
    let tabB = openTab(s);
    const erase = vi.fn();
    const window = new EventTarget(); // tab B's window
    const stop = watchDeletions(window, (dead) => {
      const r = dropDeleted(tabB, dead); // what the page does with each event
      tabB = r.store;
      if (r.openWasDeleted) erase();
    });

    const before = m.get(TOMBSTONE_KEY) ?? null;
    deleteOnDevice(() => s, deletePlan(tabA, "plan-mom"), "plan-mom");
    // The browser tells every other tab of this site about the change.
    window.dispatchEvent(Object.assign(new Event("storage"), { key: TOMBSTONE_KEY, oldValue: before, newValue: m.get(TOMBSTONE_KEY) ?? null }));

    expect(erase).toHaveBeenCalledTimes(1);
    expect(tabB.plans.map((p) => p.id)).toEqual(["plan-dad"]);
    expect(tabB.active).toBeNull();

    // A change to an unrelated key, or after unsubscribing, does nothing.
    window.dispatchEvent(Object.assign(new Event("storage"), { key: "other", newValue: "[]" }));
    stop();
    window.dispatchEvent(Object.assign(new Event("storage"), { key: TOMBSTONE_KEY, newValue: JSON.stringify(["plan-dad"]) }));
    expect(erase).toHaveBeenCalledTimes(1);
    expect(tabB.plans.map((p) => p.id)).toEqual(["plan-dad"]);
  });

  it("a deleted plan that was not open in tab B leaves B's screen alone", () => {
    const { s } = sharedStorage();
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabB = openTab(s);
    const r = dropDeleted(tabB, new Set(["plan-dad"]));
    expect(r.openWasDeleted).toBe(false);
    expect(r.store.active).toBe("plan-mom");
    expect(r.store.plans.map((p) => p.id)).toEqual(["plan-mom"]);
  });
});

describe("the deleted-plan list", () => {
  it("holds plan ids only, never paper text or names", () => {
    const { m, s } = sharedStorage();
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    deleteOnDevice(() => s, deletePlan(openTab(s), "plan-mom"), "plan-mom");
    expect(JSON.parse(m.get(TOMBSTONE_KEY)!)).toEqual(["plan-mom"]);
    expect(m.get(TOMBSTONE_KEY)).not.toContain("paper");
    expect(m.get(TOMBSTONE_KEY)).not.toContain("My plan");
  });

  it("is bounded, keeping the newest ids", () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_TOMBSTONES + 50; i++) list = addTombstone(list, `p${i}`);
    expect(list).toHaveLength(MAX_TOMBSTONES);
    expect(list.at(-1)).toBe(`p${MAX_TOMBSTONES + 49}`);
    expect(list).not.toContain("p0");
    expect(addTombstone(["a", "b"], "a")).toEqual(["b", "a"]);
  });

  it("ignores anything that is not a list of short strings", () => {
    expect(parseTombstones(null)).toEqual([]);
    expect(parseTombstones("not json")).toEqual([]);
    expect(parseTombstones(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseTombstones(JSON.stringify(["ok", 3, null, "", "x".repeat(500)]))).toEqual(["ok"]);
  });

  it("a delete that storage refuses reports failure and changes nothing", () => {
    const { m, s, state } = sharedStorage();
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const before = m.get(STORE_KEY);
    state.refuse = true;
    expect(deleteOnDevice(() => s, deletePlan(openTab(s), "plan-mom"), "plan-mom")).toBeNull();
    expect(m.get(STORE_KEY)).toBe(before);
  });
});
