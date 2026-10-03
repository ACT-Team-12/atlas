import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { persistDeletion } from "./persistDeletion";
import { deletePlan, emptyStore, saveSession, STORE_KEY, type Store } from "./savedPlans";

const session = { text: "Take 1 tablet daily.", language: "English", level: "simple", care: null, barriers: [], zip: "", note: "", plan: null, done: {}, removed: {} } as const;

function twoPlans(): Store {
  const a = saveSession(emptyStore(), { ...session, barriers: [], done: {}, removed: {} }, "2026-10-01T00:00:00Z", "plan-a");
  return saveSession({ ...a, active: null }, { ...session, text: "Call the clinic.", barriers: [], done: {}, removed: {} }, "2026-10-02T00:00:00Z", "plan-b");
}

/** A Map-backed storage; `refuse` makes setItem throw, `ignore` makes it a silent no-op. */
function storage(initial: Store, mode: "ok" | "refuse" | "ignore" = "ok") {
  const m = new Map<string, string>([[STORE_KEY, JSON.stringify(initial)]]);
  return {
    m,
    s: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (mode === "refuse") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        if (mode === "ok") m.set(k, v);
      },
    },
  };
}

describe("deleting a saved plan from this device", () => {
  it("succeeds only when the stored copy no longer holds the plan", () => {
    const store = twoPlans();
    const { m, s } = storage(store);
    expect(persistDeletion(() => s, STORE_KEY, deletePlan(store, "plan-a"), "plan-a")).toBe(true);
    const after = JSON.parse(m.get(STORE_KEY)!) as Store;
    expect(after.plans.map((p) => p.id)).toEqual(["plan-b"]);
  });

  it("reports failure when storage refuses the write, and the plan is still there after a reload", () => {
    const store = twoPlans();
    const { m, s } = storage(store, "refuse");
    expect(persistDeletion(() => s, STORE_KEY, deletePlan(store, "plan-a"), "plan-a")).toBe(false);
    // What a reload would read back.
    expect((JSON.parse(m.get(STORE_KEY)!) as Store).plans.some((p) => p.id === "plan-a")).toBe(true);
  });

  it("reports failure when a write silently does nothing", () => {
    const store = twoPlans();
    const { s } = storage(store, "ignore");
    expect(persistDeletion(() => s, STORE_KEY, deletePlan(store, "plan-a"), "plan-a")).toBe(false);
  });

  it("reports failure when storage cannot be reached at all, or holds something unreadable", () => {
    const store = twoPlans();
    expect(persistDeletion(() => { throw new DOMException("denied", "SecurityError"); }, STORE_KEY, deletePlan(store, "plan-a"), "plan-a")).toBe(false);
    const garbled = { getItem: () => "{not json", setItem: () => {} };
    expect(persistDeletion(() => garbled, STORE_KEY, deletePlan(store, "plan-a"), "plan-a")).toBe(false);
  });
});

describe("the care-plan screen never shows a failed delete as done", () => {
  const ui = readFileSync(new URL("../ui/CarePlanTool.tsx", import.meta.url), "utf8");
  const saved = readFileSync(new URL("../ui/SavedPlans.tsx", import.meta.url), "utf8");
  const body = (name: string) => {
    const at = ui.indexOf(`function ${name}(`);
    expect(at, name).toBeGreaterThanOrEqual(0);
    return ui.slice(at, ui.indexOf("\n  }\n", at));
  };

  it("Clear and Delete go through the checked delete, and stop before erasing when it failed", () => {
    // deleteOnDevice (lib/tombstones.ts) records the delete for other tabs, then writes and reads back via persistDeletion.
    expect(body("deleteFromDevice")).toMatch(/const r = deleteOnDevice\([^\n]*\);\s*if \(!r\) \{ setDeleteFailed\(true\); return false; \}/);
    expect(readFileSync(new URL("./tombstones.ts", import.meta.url), "utf8")).toMatch(/if \(!persistDeletion\(getStorage, STORE_KEY, r\.store, id\)\) return null;/);
    expect(body("clearSaved")).toMatch(/!deleteFromDevice\(storeRef\.current\.active\)\) return;\s*eraseOpenPaper\(\);/);
    expect(body("deleteSaved")).toMatch(/if \(!deleteFromDevice\(id\)\) return false;/);
    for (const name of ["clearSaved", "deleteSaved"]) expect(body(name), name).not.toMatch(/writeStore\(deletePlan/);
  });

  it("the saved-plans list says Deleted only when it was, and otherwise says how to retry", () => {
    expect(saved).toMatch(/const deleted = onDelete\(p\.id\);\s*setSaid\(deleted \? `Deleted \$\{p\.name\}\.` :/);
    expect(saved).toMatch(/\{deleteFailed && <p role="alert"/);
    expect(saved).toMatch(/could not be deleted from this device and is still saved here\. Try again\./);
    expect(ui).toMatch(/deleteFailed=\{deleteFailed\}/);
  });
});
