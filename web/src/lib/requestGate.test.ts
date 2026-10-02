import { describe, expect, it } from "vitest";
import { createRequestGate } from "./requestGate";

type In = { text: string; language: string };

/** A fake request whose answer we release by hand, the way a slow network would. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("request gate (Codex review: stale response)", () => {
  it("commits an answer whose inputs are unchanged", () => {
    const g = createRequestGate<In>();
    const t = g.start({ text: "paper A", language: "English" });
    expect(g.isCurrent(t, { text: "paper A", language: "English" })).toBe(true);
    expect(t.signal.aborted).toBe(false);
  });

  it("an edit while the request is in flight aborts it, and its late answer is never committed", async () => {
    const g = createRequestGate<In>();
    let screen: In = { text: "paper A", language: "English" };
    const committed: string[] = [];
    const answer = deferred<string>();
    const t = g.start(screen);
    const done = answer.promise.then((v) => { if (g.isCurrent(t, screen)) committed.push(v); });

    // The person edits the paper before the answer comes back.
    screen = { text: "paper A, edited", language: "English" };
    g.invalidate();
    expect(t.signal.aborted).toBe(true);

    answer.resolve("timeline for paper A");
    await done;
    expect(committed).toEqual([]);
  });

  it("a language change invalidates too", () => {
    const g = createRequestGate<In>();
    const t = g.start({ text: "paper A", language: "English" });
    g.invalidate();
    expect(g.isCurrent(t, { text: "paper A", language: "English" })).toBe(false);
  });

  it("an edit that is undone still does not revive the old request", () => {
    const g = createRequestGate<In>();
    const t = g.start({ text: "paper A", language: "English" });
    g.invalidate(); // typed a letter
    g.invalidate(); // deleted it again
    expect(g.isCurrent(t, { text: "paper A", language: "English" })).toBe(false);
  });

  it("a newer request makes the older one stale and aborts it", () => {
    const g = createRequestGate<In>();
    const a = g.start({ text: "paper A", language: "English" });
    const b = g.start({ text: "paper B", language: "Spanish" });
    expect(a.signal.aborted).toBe(true);
    expect(g.isCurrent(a, { text: "paper B", language: "Spanish" })).toBe(false);
    expect(g.isCurrent(b, { text: "paper B", language: "Spanish" })).toBe(true);
  });

  it("refuses when the inputs on screen differ from the ones sent, even without an invalidate", () => {
    const g = createRequestGate<In>();
    const t = g.start({ text: "paper A", language: "English" });
    expect(g.isCurrent(t, { text: "paper B", language: "English" })).toBe(false);
    expect(g.isCurrent(t, { text: "paper A", language: "French" })).toBe(false);
  });

  it("keeps its own copy of the inputs", () => {
    const g = createRequestGate<In>();
    const sent = { text: "paper A", language: "English" };
    const t = g.start(sent);
    sent.text = "mutated";
    expect(t.inputs.text).toBe("paper A");
  });
});
