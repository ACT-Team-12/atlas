import { describe, expect, it } from "vitest";
import type { CarePlanResponse } from "./schema";
import {
  CHECK_POLICY, checksKey, cleanName, closePlan, deletePlan, DEFAULT_NAME, emptyStore, listPlans, loadStore, nextName, openPlan, pickSession,
  progress, readStartsNewPlan, renamePlan, saveSession, type Session,
} from "./savedPlans";

const care = {
  source_text: "x", source_kind: "text", refused: [], questions_for_doctor: [], not_in_document: [], has_warning_signs: false, model: "m",
  stats: { extracted: 3, grounded: 3, refused: 0, ms: 1 },
  items: ["a", "b", "c"].map((id) => ({ id, kind: "medication", title: id, plain_language: "", when: "", source_quote: "", needs_clarification: false, question_for_clinic: "", grounded: true, span: null })),
} as unknown as CarePlanResponse;
const session = (over: Partial<Session> = {}): Session => ({ text: "paper", language: "English", level: "simple", care, barriers: [], zip: "30030", note: "", plan: null, done: {}, removed: {}, ...over });

describe("readStartsNewPlan", () => {
  const base = { openPlanHasPaper: true, fresh: true, isPhoto: false, sameText: false };
  it("a different paper starts a new plan, so the open one is not overwritten", () => expect(readStartsNewPlan(base)).toBe(true));
  it("a new photo starts a new plan", () => expect(readStartsNewPlan({ ...base, isPhoto: true, sameText: true })).toBe(true));
  it("the same text read again stays in the open plan", () => expect(readStartsNewPlan({ ...base, sameText: true })).toBe(false));
  it("simpler or a corrected photo reading stays in the open plan", () => expect(readStartsNewPlan({ ...base, fresh: false })).toBe(false));
  it("no open plan with a paper: nothing to protect", () => expect(readStartsNewPlan({ ...base, openPlanHasPaper: false })).toBe(false));
});

describe("cleanName", () => {
  it("trims and keeps one line", () => expect(cleanName("  Mom \n plan ")).toBe("Mom plan"));
  it("falls back when empty", () => expect(cleanName("   ")).toBe(DEFAULT_NAME));
  it("caps the length", () => expect(cleanName("a".repeat(100))).toHaveLength(40));
});

describe("pickSession", () => {
  it("never keeps a location", () => {
    const withLoc = { ...session(), loc: { lat: 33.7, lng: -84.3 }, location: { lat: 1, lng: 2 } } as unknown as Session;
    const kept = pickSession(withLoc) as Record<string, unknown>;
    expect(kept.loc).toBeUndefined();
    expect(kept.location).toBeUndefined();
    expect(JSON.stringify(kept)).not.toContain("33.7");
  });

  it("an old or edited save with a language or level that is no longer a choice gets the default, not a crash", () => {
    const odd = { ...session(), language: "Klingon", level: "expert" } as unknown as Session;
    const kept = pickSession(odd);
    expect(kept.language).toBe("English");
    expect(kept.level).toBe("simple");
    expect(pickSession({ ...session(), language: "Amharic", level: "detailed" }).language).toBe("Amharic");
    expect(pickSession({ ...session(), language: "Amharic", level: "detailed" }).level).toBe("detailed");
  });

  it("a replaced language or level un-certifies the saved results, so they show as out of date (Codex round 2)", () => {
    expect(pickSession({ ...session(), level: "expert", matched: true } as unknown as Session).matched).toBe(false);
    expect(pickSession({ ...session(), language: "Klingon", matched: true } as unknown as Session).matched).toBe(false);
    expect(pickSession({ ...session(), language: "Spanish", level: "standard", matched: true }).matched).toBe(true);
  });
});

describe("pickSession matched", () => {
  it("keeps matched only when it is exactly true (older saves have none)", () => {
    expect(pickSession({ ...session(), matched: true }).matched).toBe(true);
    expect(pickSession(session()).matched).toBe(false);
    expect(pickSession({ ...session(), matched: "yes" } as unknown as Session).matched).toBe(false);
  });
});

describe("loadStore", () => {
  it("migrates the old single saved session into the list and opens it", () => {
    const old = JSON.stringify({ ...session({ done: { a: true } }), savedAt: "2026-10-01T10:00:00.000Z" });
    const { store, migrated } = loadStore(null, old, "id1");
    expect(migrated).toBe(true);
    expect(store.active).toBe("id1");
    expect(store.plans).toHaveLength(1);
    expect(store.plans[0]).toMatchObject({ id: "id1", name: DEFAULT_NAME, savedAt: "2026-10-01T10:00:00.000Z", done: { a: true } });
  });
  it("drops an old session with nothing read", () => {
    const { store, migrated } = loadStore(null, JSON.stringify(session({ care: null })), "id1");
    expect(store.plans).toHaveLength(0);
    expect(migrated).toBe(true);
  });
  it("keeps an existing list and still asks to remove a leftover old key", () => {
    const s = saveSession(emptyStore(), session(), "2026-10-02T00:00:00.000Z", "p1");
    const { store, migrated } = loadStore(JSON.stringify(s), JSON.stringify(session()), "new");
    expect(store.plans.map((p) => p.id)).toEqual(["p1"]);
    expect(migrated).toBe(true);
  });
  it("survives broken storage", () => {
    expect(loadStore("{not json", null, "x").store).toEqual(emptyStore());
    expect(loadStore("{not json", "also broken", "x").store).toEqual(emptyStore());
  });
  it("forgets an open id that no longer exists", () => {
    const raw = JSON.stringify({ v: 2, active: "gone", plans: [] });
    expect(loadStore(raw, null, "x").store.active).toBeNull();
  });
});

describe("saving, renaming, opening, deleting", () => {
  it("saves into a new named plan, then updates the open one", () => {
    let s = saveSession(emptyStore(), session(), "t1", "p1");
    expect(s).toMatchObject({ active: "p1", plans: [{ id: "p1", name: DEFAULT_NAME, createdAt: "t1", savedAt: "t1" }] });
    s = saveSession(s, session({ done: { a: true } }), "t2", "unused");
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ createdAt: "t1", savedAt: "t2", done: { a: true } });
  });
  it("opening a plan without changing it keeps its saved date", () => {
    const s = saveSession(emptyStore(), session(), "t1", "p1");
    expect(saveSession(s, session(), "t9", "x")).toBe(s);
  });
  it("keeps progress per plan", () => {
    let s = saveSession(emptyStore(), session({ done: { a: true } }), "t1", "mom");
    s = renamePlan(s, "mom", "Mom");
    s = saveSession(closePlan(s), session({ done: { a: true, b: true } }), "t2", "dad");
    s = renamePlan(s, "dad", "Dad");
    const byName = Object.fromEntries(s.plans.map((p) => [p.name, progress(p)]));
    expect(byName).toEqual({ Mom: { done: 1, total: 3 }, Dad: { done: 2, total: 3 } });
  });
  it("progress skips removed steps", () => {
    const s = saveSession(emptyStore(), session({ done: { a: true, c: true }, removed: { c: true } }), "t", "p");
    expect(progress(s.plans[0])).toEqual({ done: 1, total: 2 });
  });
  it("names new plans so they do not clash", () => {
    let s = saveSession(emptyStore(), session(), "t1", "p1");
    expect(nextName(s)).toBe(`${DEFAULT_NAME} 2`);
    s = saveSession(closePlan(s), session(), "t2", "p2");
    expect(s.plans[1].name).toBe(`${DEFAULT_NAME} 2`);
  });
  it("opens only plans that exist", () => {
    const s = saveSession(emptyStore(), session(), "t1", "p1");
    expect(openPlan(closePlan(s), "p1").active).toBe("p1");
    expect(openPlan(closePlan(s), "nope").active).toBeNull();
  });
  it("deleting the open plan closes it; deleting another keeps it open", () => {
    let s = saveSession(emptyStore(), session(), "t1", "p1");
    s = saveSession(closePlan(s), session(), "t2", "p2");
    expect(deletePlan(s, "p1")).toMatchObject({ active: "p2", plans: [{ id: "p2" }] });
    expect(deletePlan(s, "p2")).toMatchObject({ active: null, plans: [{ id: "p1" }] });
  });
  it("lists newest first", () => {
    let s = saveSession(emptyStore(), session(), "2026-10-01", "old");
    s = saveSession(closePlan(s), session(), "2026-10-02", "new");
    expect(listPlans(s).map((p) => p.id)).toEqual(["new", "old"]);
  });
});

describe("saved check verdicts (kept on this device, never re-sent)", () => {
  const ok = (id: string) => ({ id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same", what_differs: "", certified: true });
  const key = checksKey(care.items, care.language);
  it("the key changes with any step's words or the language", () => {
    expect(checksKey(care.items, "Spanish")).not.toBe(key);
    expect(checksKey(care.items.map((i, n) => (n === 0 ? { ...i, source_quote: "other" } : i)), care.language)).not.toBe(key);
    expect(checksKey(care.items, care.language)).toBe(key);
  });
  it("well-formed verdicts are kept", () => {
    const kept = pickSession({ ...session(), checks: { key, policy: CHECK_POLICY, byId: { a: ok("a") } } } as unknown as Session);
    expect(kept.checks?.byId.a.certified).toBe(true);
  });
  it("a malformed or impossible verdict drops the whole set: nothing is trusted that the check could not have said", () => {
    for (const bad of [
      { a: { ...ok("a"), id: "b" } },
      { a: { ...ok("a"), certified: "yes" } },
      { a: { ...ok("a"), model_verdict: "different" } }, // certified but the model said different
      { a: { ...ok("a"), numbers_ok: false } },
      { a: { ...ok("a"), flagged: true } },
      { a: null },
    ]) expect(pickSession({ ...session(), checks: { key, policy: CHECK_POLICY, byId: bad } } as unknown as Session).checks).toBeUndefined();
    expect(pickSession({ ...session(), checks: "x" } as unknown as Session).checks).toBeUndefined();
  });
  it("verdicts made under other checking rules are not restored", () => {
    expect(pickSession({ ...session(), checks: { key, policy: "older", byId: { a: ok("a") } } } as unknown as Session).checks).toBeUndefined();
    expect(pickSession({ ...session(), checks: { key, byId: { a: ok("a") } } } as unknown as Session).checks).toBeUndefined();
  });
  it("a save without verdicts removes the old ones, so nothing stale lingers", () => {
    let store = saveSession(emptyStore(), session({ checks: { key, policy: CHECK_POLICY, byId: { a: ok("a") } } } as Partial<Session>), "t1", "p1");
    expect(store.plans[0].checks).toBeDefined();
    store = saveSession(store, session({ text: "a new paper" }), "t2", "p2");
    expect(store.plans[0].checks).toBeUndefined();
    expect(JSON.stringify(store)).not.toContain("\"certified\"");
  });
});
