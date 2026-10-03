import { describe, expect, it } from "vitest";
import { RunFence, runMeaningCheck, type MeaningBody, type MeaningState, type PostMeaning } from "./meaningRun";
import type { MeaningResponse, MeaningResult } from "./meaning";
import type { VerifiedItem } from "./schema";

const item = (id: string, quote: string) => ({ id, kind: "medication", title: id, plain_language: `About ${quote}`, when: "", source_quote: quote }) as unknown as VerifiedItem;

const verdict = (id: string, flagged: boolean): MeaningResult => ({
  id, flagged, numbers_ok: !flagged, unexpected_numbers: [], model_verdict: flagged ? "different" : "same", what_differs: "", certified: !flagged,
});
const reply = (results: MeaningResult[]): MeaningResponse => ({ results, flagged: results.filter((r) => r.flagged).length, checker_model: "test", ms: 1 });

/** A post whose replies the test settles by hand, in any order. */
function manualPost() {
  const pending: { body: MeaningBody; signal: AbortSignal; resolve: (v: { ok: boolean; json: MeaningResponse }) => void; reject: (e: unknown) => void }[] = [];
  const post: PostMeaning = (body, signal) => new Promise((resolve, reject) => {
    pending.push({ body, signal, resolve, reject });
    signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
  return { post, pending };
}

describe("meaning check runs", () => {
  it("an older reply never applies over a newer read, even when both reads look alike and the old reply lands last", async () => {
    // Two reads with the same length, item count and timing: the old key `len:items:ms` could not tell them apart.
    const older = [item("item-0", "Take 1 tablet daily.")];
    const newer = [item("item-0", "Stop 1 tablet daily.")];
    const fence = new RunFence();
    const { post, pending } = manualPost();
    const states: MeaningState[] = [];
    const apply = (s: MeaningState) => states.push(s);

    const first = runMeaningCheck(fence, older, post, apply);
    const second = runMeaningCheck(fence, newer, post, apply);
    pending[1].resolve({ ok: true, json: reply([verdict("item-0", true)]) }); // newer finishes first
    await second;
    pending[0].resolve({ ok: true, json: reply([verdict("item-0", false)]) }); // older lands afterwards
    await first;

    const last = states.at(-1)!;
    expect(last.status).toBe("done");
    expect(last.byId["item-0"].flagged).toBe(true); // the newer paper's verdict stays
  });

  it("starting a new check aborts the older request", () => {
    const fence = new RunFence();
    const { post, pending } = manualPost();
    void runMeaningCheck(fence, [item("item-0", "a")], post, () => {});
    void runMeaningCheck(fence, [item("item-0", "b")], post, () => {});
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
  });

  it("Clear aborts the request in flight and shows nothing for it, not even an error", async () => {
    const fence = new RunFence();
    const { post, pending } = manualPost();
    const states: MeaningState[] = [];
    const run = runMeaningCheck(fence, [item("item-0", "Take 1 tablet daily.")], post, (s) => states.push(s));
    expect(states.map((s) => s.status)).toEqual(["loading"]);
    fence.cancel(); // Clear, Delete, another plan opened, or the page unmounted
    expect(pending[0].signal.aborted).toBe(true);
    await run;
    expect(states.map((s) => s.status)).toEqual(["loading"]);
  });

  it("a reply that arrives after Clear (the abort raced the response) is dropped", async () => {
    const fence = new RunFence();
    const states: MeaningState[] = [];
    let settle: (v: { ok: boolean; json: MeaningResponse }) => void = () => {};
    const post: PostMeaning = () => new Promise((r) => { settle = r; }); // ignores the signal: the reply was already on its way
    const run = runMeaningCheck(fence, [item("item-0", "a")], post, (s) => states.push(s));
    fence.cancel();
    settle({ ok: true, json: reply([verdict("item-0", false)]) });
    await run;
    expect(states.map((s) => s.status)).toEqual(["loading"]);
  });
});
