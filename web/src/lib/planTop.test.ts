import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlanResponse, ResourceCard } from "./plan";
import { helpsLine, primaryAction, rankResources, topResources } from "./planTop";
import { callScript, resourceScript } from "./booking";

const clinic = (id: string, km: number | null, phone = "404-555-0100"): ResourceCard => ({
  type: "clinic", id, km,
  clinic: { id, name: `Clinic ${id}`, org: "", address: "1 Main St", city: "Atlanta", zip: "30303", county: "", phone, website: "", lat: 0, lng: 0, hours_per_week: null, setting: "", health_center_type: "", nearest_rail: null, nearest_bus: null, barriers: [], source_id: "hrsa" },
});
const program = (id: string, access: { phone?: string; url?: string; text?: string } = { url: "https://p.example" }, name = `Program ${id}`, quote = "Help with bills."): ResourceCard => ({
  type: "program", id, program: { id, name, barriers: [], access, languages: [], evidence_quote: quote, source_url: "https://p.example/about" },
});
const step = (barrier: string, resource_ids: string[]) => ({ title: `Step ${barrier}`, action: "Do it.", why: "", barrier, care_ids: [], resource_ids, dropped_refs: [] });

function plan(steps: ReturnType<typeof step>[], cards: ResourceCard[]): Pick<PlanResponse, "steps" | "resources"> {
  return { steps, resources: Object.fromEntries(cards.map((c) => [c.id, c])) };
}

describe("rankResources: how many problems each verified place helps with", () => {
  it("counts the plan steps that list each resource, most first", () => {
    const p = plan([step("cost", ["a", "b"]), step("food", ["b", "c"]), step("transport", ["b"])], [program("a"), program("b"), program("c")]);
    const r = rankResources(p);
    expect(r.map((x) => [x.id, x.steps.length])).toEqual([["b", 3], ["a", 1], ["c", 1]]);
    expect(r[0].steps).toEqual([0, 1, 2]);
  });

  it("gives each resource the barrier chips of the steps that use it, each once, in plan order", () => {
    const p = plan([step("cost", ["a"]), step("food", ["a"]), step("cost", ["a"])], [program("a")]);
    expect(rankResources(p)[0].barriers).toEqual(["cost", "food"]);
  });

  it("breaks ties by distance: nearer first, and a place with no distance after any place with one", () => {
    const p = plan([step("cost", ["prog", "far", "near", "unknown"])], [program("prog"), clinic("far", 9.2), clinic("near", 0.7), clinic("unknown", null)]);
    expect(rankResources(p).map((x) => x.id)).toEqual(["near", "far", "prog", "unknown"]);
  });

  it("then keeps the plan's own order", () => {
    const p = plan([step("cost", ["x"]), step("food", ["y"])], [program("y"), program("x")]);
    expect(rankResources(p).map((x) => x.id)).toEqual(["x", "y"]);
  });

  it("the person's problems come first: two problems beat three steps about one problem", () => {
    const p = plan([step("cost", ["oneProblem"]), step("cost", ["oneProblem", "twoProblems"]), step("cost", ["oneProblem"]), step("food", ["twoProblems"])], [program("oneProblem"), program("twoProblems")]);
    const r = rankResources(p);
    expect(r.map((x) => [x.id, x.barriers.length, x.steps.length])).toEqual([["twoProblems", 2, 2], ["oneProblem", 1, 3]]);
  });

  it("a count beats distance", () => {
    const p = plan([step("cost", ["near", "prog"]), step("food", ["prog"])], [clinic("near", 0.2), program("prog")]);
    expect(rankResources(p).map((x) => x.id)).toEqual(["prog", "near"]);
  });

  it("shows each resource once, even when a step lists it twice, and skips ids with no verified record", () => {
    const p = plan([step("cost", ["a", "a", "ghost"]), step("food", ["a"])], [program("a")]);
    const r = rankResources(p);
    expect(r).toHaveLength(1);
    expect(r[0].steps).toEqual([0, 1]);
  });

  it("drops a barrier that is not one of ATLAS's barriers", () => {
    const p = plan([step("", ["a"]), step("made-up", ["a"])], [program("a")]);
    expect(rankResources(p)[0].barriers).toEqual([]);
    expect(rankResources(p)[0].steps).toHaveLength(2);
  });

  it("is deterministic: same answer every time, whatever order the resources object holds", () => {
    const steps = [step("cost", ["c1", "p1", "c2"]), step("food", ["p1", "p2"]), step("transport", ["c2", "p2"])];
    const a = plan(steps, [clinic("c1", 1.5), program("p1"), clinic("c2", 3), program("p2")]);
    const b = plan(steps, [program("p2"), clinic("c2", 3), program("p1"), clinic("c1", 1.5)]);
    const ids = (x: typeof a) => rankResources(x).map((r) => r.id);
    expect(ids(a)).toEqual(["c2", "p1", "p2", "c1"]);
    expect(ids(b)).toEqual(ids(a));
    expect(ids(a)).toEqual(ids(a));
  });

  it("topResources keeps the first three", () => {
    const p = plan([step("cost", ["a", "b", "c", "d"])], [program("a"), program("b"), program("c"), program("d")]);
    expect(topResources(p).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(topResources(plan([], []))).toEqual([]);
  });

  it("on the live demo plan (sample paper near 30303): every place is used once, so the nearest clinics lead", () => {
    const live = JSON.parse(readFileSync(join(process.cwd(), "../mobile/ios/ATLASTests/Fixtures/plan_sample_30303_live.json"), "utf8")) as PlanResponse;
    const top = topResources(live);
    expect(top.map((r) => r.id)).toEqual(["hrsa-mercy-care-at-gateway-center-30303", "hrsa-mercy-care-decatur-street-30312", "georgia-medicaid-apply"]);
    expect(top.map((r) => r.barriers)).toEqual([["cost"], ["cost"], ["cost"]]);
    expect(new Set(rankResources(live).map((r) => r.id)).size).toBe(rankResources(live).length);
  });
});

describe("helpsLine: counts the problems the person named, never plan steps", () => {
  it("the live demo plan: 2 barriers picked, 6 plan steps, each top place helps with 1 of the 2", () => {
    const live = JSON.parse(readFileSync(join(process.cwd(), "../mobile/ios/ATLASTests/Fixtures/plan_sample_30303_live.json"), "utf8")) as PlanResponse;
    expect(live.steps).toHaveLength(6);
    const lines = topResources(live).map((r) => helpsLine(r, ["transport", "cost"]));
    expect(lines).toEqual(Array(3).fill("Helps with 1 of the 2 problems you named:"));
  });
  it("one problem named; duplicates and unknown values in the choice are not counted", () => {
    expect(helpsLine({ barriers: ["cost"], steps: [0, 2] }, ["cost"])).toBe("Helps with the problem you named:");
    expect(helpsLine({ barriers: ["cost", "food"], steps: [0, 1] }, ["cost", "food", "cost", "made-up"])).toBe("Helps with 2 of the 2 problems you named:");
  });
  it("with no barrier to count, says how many plan steps use it", () => {
    expect(helpsLine({ barriers: [], steps: [0, 3] }, [])).toBe("Part of 2 steps in your plan");
    expect(helpsLine({ barriers: [], steps: [1] }, ["cost"])).toBe("Part of 1 step in your plan");
  });
});

describe("primaryAction: the one big button", () => {
  it("calls a verified phone number first", () => {
    expect(primaryAction(clinic("c", 1, "(404) 880-3719"))).toEqual({ label: "Call (404) 880-3719", href: "tel:4048803719", external: false });
    expect(primaryAction(program("p", { phone: "211", url: "https://u.example" }))).toMatchObject({ label: "Call 211", href: "tel:211" });
  });
  it("says Apply online only when the verified name or quote is about applying", () => {
    expect(primaryAction(program("g", { url: "https://gateway.example" }, "Georgia Gateway (apply for Medicaid, SNAP)"))).toMatchObject({ label: "Apply online", external: true });
    expect(primaryAction(program("m", { url: "https://marta.example" }, "MARTA Reduced Fare Program", "Reduced fares for seniors."))).toMatchObject({ label: "Open their website" });
  });
  it("a clinic with no phone or website gets transit directions; a text-only program gets no button", () => {
    expect(primaryAction(clinic("c", 1, ""))?.label).toBe("Transit directions");
    expect(primaryAction(program("t", { text: "Text FOOD to 12345" }))).toBeNull();
  });
});

describe("resourceScript: what to say, from Book it now's own lines", () => {
  it("names the place and the problems, then asks the same questions Book it now asks", () => {
    const s = resourceScript("Mercy Care", ["cost", "transport"], "English");
    expect(s[0]).toBe("Hi, I'm calling about Mercy Care. I'd like to know if you can help me.");
    expect(s[1]).toBe("I need help with: paying for the visit, lab or medicine; getting there (no car, long bus ride).");
    const book = callScript({ id: "x", kind: "lab_test", title: "A1c", when: "", source_quote: "Get an A1c" }, ["cost", "transport"]);
    for (const line of book.slice(2)) expect(s).toContain(line); // the cost and transport questions, and the closing line
  });
  it("adds no facts: no digits unless the place's own name has them", () => {
    const s = resourceScript("Food Bank", ["cost", "schedule", "transport", "referrals", "tech", "language", "food", "housing", "insurance"], "Spanish").join(" ");
    expect(s.match(/\d/g)).toBeNull();
    expect(s).toContain("interpreter in Spanish");
  });
});
