import { describe, expect, it } from "vitest";
import { autosaveStore } from "./autosave";
import { persistDeletion } from "./persistDeletion";
import { deletePlan, emptyStore, saveSession, STORE_KEY, type Session } from "./savedPlans";
import type { CarePlanResponse } from "./schema";

const PAPER = "Take 1 tablet of metformin by mouth 2 times a day. Private paper text.";
const care = { source_text: PAPER, items: [], stats: { grounded: 0, refused: 0, ms: 1 } } as unknown as CarePlanResponse;
const session: Session = { text: PAPER, language: "English", level: "simple", care, barriers: [], zip: "", note: "", plan: null, done: {}, removed: {} };

function shared() {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } };
}

describe("save-on-change after the open plan is deleted", () => {
  it("a save still pending from the render before Clear does not write the deleted paper back", () => {
    const { m, s } = shared();
    const saved = saveSession(emptyStore(), session, "2026-10-03T00:00:00Z", "plan-a");
    s.setItem(STORE_KEY, JSON.stringify(saved));
    let epoch = 0;
    const renderedEpoch = epoch; // the effect for this render is scheduled, not yet run

    // Clear: delete the open plan, confirmed on disk, and end the session.
    const next = deletePlan(saved, "plan-a");
    expect(persistDeletion(() => s, STORE_KEY, next, "plan-a")).toBe(true);
    epoch++;

    // The stale effect now runs against the live store, which has no open plan.
    const out = autosaveStore({ loaded: true, epoch: renderedEpoch, currentEpoch: epoch, store: next, session, now: "2026-10-03T00:00:01Z", newId: "plan-b" });
    if (out) s.setItem(STORE_KEY, JSON.stringify(out));
    expect(out).toBeNull();
    expect(m.get(STORE_KEY)).not.toContain("Private paper text");
  });

  it("a save from the current session still saves", () => {
    const out = autosaveStore({ loaded: true, epoch: 2, currentEpoch: 2, store: emptyStore(), session, now: "2026-10-03T00:00:00Z", newId: "plan-a" });
    expect(out?.plans.map((p) => p.id)).toEqual(["plan-a"]);
    expect(out?.active).toBe("plan-a");
  });

  it("saves nothing before the store was loaded, or when there is no paper and no plan", () => {
    expect(autosaveStore({ loaded: false, epoch: 0, currentEpoch: 0, store: emptyStore(), session, now: "t", newId: "x" })).toBeNull();
    expect(autosaveStore({ loaded: true, epoch: 0, currentEpoch: 0, store: emptyStore(), session: { ...session, care: null }, now: "t", newId: "x" })).toBeNull();
  });
});
