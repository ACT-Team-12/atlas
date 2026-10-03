import { describe, expect, it, vi } from "vitest";
import { addTombstone, DeletedPlans, deleteOnDevice, dropDeleted, MAX_TOMBSTONES, parseTombstones, saveStore, TOMBSTONE_KEY, watchDeletions } from "./tombstones";
import { deletePlan, emptyStore, loadStore, saveSession, STORE_KEY, type Session, type Store } from "./savedPlans";
import type { CarePlanResponse } from "./schema";

const paper = (who: string) => `Take 1 tablet of metformin by mouth 2 times a day. ${who}'s private paper.`;
const care = (text: string) => ({ source_text: text, items: [], stats: { grounded: 0, refused: 0, ms: 1 } }) as unknown as CarePlanResponse;
const session = (text: string): Session => ({ text, language: "English", level: "simple", care: care(text), barriers: [], zip: "", note: "", plan: null, done: {}, removed: {} });

type Shared = ReturnType<typeof sharedStorage>;

/** One site's localStorage, shared by every tab. `refuse` makes every write throw (storage full or disabled). */
function sharedStorage() {
  const m = new Map<string, string>();
  const state = { refuse: false, ignoreTombstones: false };
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (state.refuse) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      if (state.ignoreTombstones && k === TOMBSTONE_KEY) return;
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

/** A tab: its deleted-ids ledger and its in-memory copy, loaded the way the page loads it. */
function openTab({ s }: Shared) {
  const deleted = new DeletedPlans(() => s);
  return { deleted, store: dropDeleted(loadStore(s.getItem(STORE_KEY), null, "unused").store, deleted.all()).store, window: new EventTarget() };
}

/** What the browser does after a write: tell the other tabs (never the writer). */
function notify(tab: { window: EventTarget }, key: string, m: Map<string, string>) {
  tab.window.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: m.get(key) ?? null }));
}

const idsOnDisk = (m: Map<string, string>) => (JSON.parse(m.get(STORE_KEY)!) as Store).plans.map((p) => p.id);

describe("a plan deleted in one tab stays deleted in the others", () => {
  it("tab B, still holding the old list, saves a checkbox and the deleted plan does not come back", () => {
    const sh = sharedStorage();
    const { m, s } = sh;
    s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(sh);
    const tabB = openTab(sh); // loaded before the delete

    expect(deleteOnDevice(() => s, tabA.deleted, deletePlan(tabA.store, "plan-mom"), "plan-mom")).not.toBeNull();

    // B ticks a step on its (stale) open plan: the whole store is written from B's memory.
    const r = saveStore(() => s, tabB.deleted, saveSession(tabB.store, { ...session(paper("Mom")), done: { "item-0": true } }, "2026-10-03T00:00:00Z", "unused"));
    expect(m.get(STORE_KEY)).not.toContain("plan-mom");
    expect(m.get(STORE_KEY)).not.toContain("Mom's private paper");
    expect(idsOnDisk(m)).toEqual(["plan-dad"]);
    expect(r.openWasDeleted).toBe(true); // B is told to erase the paper from its screen
    expect(r.store.active).toBeNull();
    expect(openTab(sh).store.plans.map((p) => p.id)).toEqual(["plan-dad"]); // and a reload agrees
  });

  it("a delete in tab B does not write back a plan tab A already deleted", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(sh);
    const tabB = openTab(sh);
    expect(deleteOnDevice(() => sh.s, tabA.deleted, deletePlan(tabA.store, "plan-mom"), "plan-mom")).not.toBeNull();
    const r = deleteOnDevice(() => sh.s, tabB.deleted, deletePlan(tabB.store, "plan-dad"), "plan-dad");
    expect(r).not.toBeNull();
    expect(r!.store.plans).toEqual([]);
    expect(idsOnDisk(sh.m)).toEqual([]);
  });

  it("a page load drops a deleted plan an older tab wrote back", () => {
    const sh = sharedStorage();
    sh.s.setItem(TOMBSTONE_KEY, JSON.stringify(["plan-mom"]));
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans())); // written by a tab without this fix
    const loaded = openTab(sh).store;
    expect(loaded.plans.map((p) => p.id)).toEqual(["plan-dad"]);
    expect(loaded.active).toBeNull();
  });

  it("tab B, with the deleted plan open, hears the storage event and erases its screen", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(sh);
    const tabB = openTab(sh);
    let shown = tabB.store;
    const erase = vi.fn();
    const stop = watchDeletions(tabB.window, () => sh.s, tabB.deleted, (dead) => {
      const r = dropDeleted(shown, dead); // what the page does with each event
      shown = r.store;
      if (r.openWasDeleted) erase();
    });

    deleteOnDevice(() => sh.s, tabA.deleted, deletePlan(tabA.store, "plan-mom"), "plan-mom");
    notify(tabB, TOMBSTONE_KEY, sh.m);

    expect(erase).toHaveBeenCalledTimes(1);
    expect(shown.plans.map((p) => p.id)).toEqual(["plan-dad"]);
    expect(shown.active).toBeNull();

    // A change to an unrelated key, or after unsubscribing, does nothing.
    tabB.window.dispatchEvent(Object.assign(new Event("storage"), { key: "other", newValue: "[]" }));
    stop();
    sh.s.setItem(TOMBSTONE_KEY, JSON.stringify(["plan-mom", "plan-dad"]));
    notify(tabB, TOMBSTONE_KEY, sh.m);
    expect(erase).toHaveBeenCalledTimes(1);
    expect(shown.plans.map((p) => p.id)).toEqual(["plan-dad"]);
  });

  it("a deleted plan that was not open in tab B leaves B's screen alone", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const r = dropDeleted(openTab(sh).store, new Set(["plan-dad"]));
    expect(r.openWasDeleted).toBe(false);
    expect(r.store.active).toBe("plan-mom");
    expect(r.store.plans.map((p) => p.id)).toEqual(["plan-mom"]);
  });
});

describe("races between tabs (two keys cannot be written atomically)", () => {
  it("save vs delete: a stale write that lands just after the delete is undone by the tab that deleted", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(sh);
    const tabB = openTab(sh);
    watchDeletions(tabA.window, () => sh.s, tabA.deleted, () => {});

    deleteOnDevice(() => sh.s, tabA.deleted, deletePlan(tabA.store, "plan-mom"), "plan-mom");
    // B read the deleted list just before A wrote it, so B's write still holds Mom's plan.
    sh.s.setItem(STORE_KEY, JSON.stringify(saveSession(tabB.store, session(paper("Mom")), "2026-10-03T00:00:00Z", "unused")));
    expect(sh.m.get(STORE_KEY)).toContain("Mom's private paper");
    notify(tabA, STORE_KEY, sh.m);

    expect(sh.m.get(STORE_KEY)).not.toContain("Mom's private paper");
    expect(idsOnDisk(sh.m)).toEqual(["plan-dad"]);
  });

  it("delete vs delete: a list that lost an entry to a concurrent delete is put right, and the plan stays deleted", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(sh);
    watchDeletions(tabA.window, () => sh.s, tabA.deleted, () => {});

    deleteOnDevice(() => sh.s, tabA.deleted, deletePlan(tabA.store, "plan-mom"), "plan-mom");
    // B deleted Dad's plan at the same moment, from a list read before A's write: last write wins, Mom's entry is gone.
    sh.s.setItem(TOMBSTONE_KEY, JSON.stringify(["plan-dad"]));
    notify(tabA, TOMBSTONE_KEY, sh.m);
    expect(parseTombstones(sh.m.get(TOMBSTONE_KEY)!).sort()).toEqual(["plan-dad", "plan-mom"]);

    // So a third, stale tab still cannot write Mom's plan back.
    const stale = { ...twoPlans() };
    const tabC = openTab(sh);
    const r = saveStore(() => sh.s, tabC.deleted, stale);
    expect(r.store.plans).toEqual([]);
    expect(sh.m.get(STORE_KEY)).not.toContain("Mom's private paper");
  });

  it("the deleting tab remembers the id even when the list write was dropped, so its own writes never restore the plan", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tabA = openTab(sh);
    sh.state.ignoreTombstones = true;
    expect(tabA.deleted.mark("plan-mom")).toBe(false); // the read-back does not hold it: not verified
    const r = saveStore(() => sh.s, tabA.deleted, twoPlans());
    expect(r.store.plans.map((p) => p.id)).toEqual(["plan-dad"]);
    // Once storage accepts writes again, the next repair puts the id on disk.
    sh.state.ignoreTombstones = false;
    expect(tabA.deleted.repairList()).toBe(true);
    expect(parseTombstones(sh.m.get(TOMBSTONE_KEY)!)).toEqual(["plan-mom"]);
  });
});

describe("the deleted-plan list", () => {
  it("holds plan ids only, never paper text or names", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tab = openTab(sh);
    deleteOnDevice(() => sh.s, tab.deleted, deletePlan(tab.store, "plan-mom"), "plan-mom");
    expect(JSON.parse(sh.m.get(TOMBSTONE_KEY)!)).toEqual(["plan-mom"]);
    expect(sh.m.get(TOMBSTONE_KEY)).not.toContain("paper");
    expect(sh.m.get(TOMBSTONE_KEY)).not.toContain("My plan");
  });

  it("is bounded, keeping the newest ids", () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_TOMBSTONES + 50; i++) list = addTombstone(list, `p${i}`);
    expect(list).toHaveLength(MAX_TOMBSTONES);
    expect(list.at(-1)).toBe(`p${MAX_TOMBSTONES + 49}`);
    expect(list).not.toContain("p0");
    expect(addTombstone(["a", "b"], "a")).toEqual(["b", "a"]);

    const sh = sharedStorage();
    const deleted = new DeletedPlans(() => sh.s);
    for (let i = 0; i < MAX_TOMBSTONES + 50; i++) deleted.mark(`p${i}`);
    expect(parseTombstones(sh.m.get(TOMBSTONE_KEY)!)).toHaveLength(MAX_TOMBSTONES);
    expect(deleted.all().size).toBe(MAX_TOMBSTONES);
  });

  it("ignores anything that is not a list of short strings", () => {
    expect(parseTombstones(null)).toEqual([]);
    expect(parseTombstones("not json")).toEqual([]);
    expect(parseTombstones(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseTombstones(JSON.stringify(["ok", 3, null, "", "x".repeat(500)]))).toEqual(["ok"]);
  });

  it("a delete that storage refuses reports failure and changes nothing", () => {
    const sh = sharedStorage();
    sh.s.setItem(STORE_KEY, JSON.stringify(twoPlans()));
    const tab = openTab(sh);
    const before = sh.m.get(STORE_KEY);
    sh.state.refuse = true;
    expect(deleteOnDevice(() => sh.s, tab.deleted, deletePlan(tab.store, "plan-mom"), "plan-mom")).toBeNull();
    expect(sh.m.get(STORE_KEY)).toBe(before);
  });
});
