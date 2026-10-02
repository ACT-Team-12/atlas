import { describe, expect, it } from "vitest";
import { keyTarget, restoredTab, scrollTargetAfter, shownTab, tabInfo } from "./phoneTabs";

const fresh = { hasCare: false, hasPlan: false };
const read = { hasCare: true, hasPlan: false };
const planned = { hasCare: true, hasPlan: true };
const planNoPaper = { hasCare: false, hasPlan: true };

describe("tabInfo", () => {
  it("keeps step 2 open without a paper, because the paper is optional", () => {
    expect(tabInfo(fresh)[2].available).toBe(true);
  });
  it("closes the plan tab until a plan exists, and says why", () => {
    expect(tabInfo(fresh)[3]).toMatchObject({ available: false, why: "Make your plan in step 2 first" });
    expect(tabInfo(read)[3].available).toBe(false);
    expect(tabInfo(planned)[3]).toMatchObject({ available: true, why: null });
  });
  it("marks steps done like the step headers do", () => {
    expect([1, 2, 3].map((t) => tabInfo(read)[t as 1 | 2 | 3].done)).toEqual([true, false, false]);
    expect([1, 2, 3].map((t) => tabInfo(planned)[t as 1 | 2 | 3].done)).toEqual([true, true, true]);
    expect([1, 2, 3].map((t) => tabInfo(planNoPaper)[t as 1 | 2 | 3].done)).toEqual([false, true, true]);
  });
});

describe("shownTab", () => {
  it("shows the chosen tab when it is open", () => {
    expect(shownTab(3, planned)).toBe(3);
    expect(shownTab(2, fresh)).toBe(2);
  });
  it("falls back when the plan goes away (a new paper or a new plan clears it)", () => {
    expect(shownTab(3, read)).toBe(2);
    expect(shownTab(3, fresh)).toBe(2);
  });
});

describe("restoredTab", () => {
  it("opens the plan when a plan was saved", () => expect(restoredTab(planned)).toBe(3));
  it("opens the plan even if it was made without a paper", () => expect(restoredTab(planNoPaper)).toBe(3));
  it("opens your needs when only a paper was saved", () => expect(restoredTab(read)).toBe(2));
  it("opens the paper when nothing was saved", () => expect(restoredTab(fresh)).toBe(1));
});

describe("keyTarget", () => {
  it("moves right and left, wrapping, over open tabs only", () => {
    expect(keyTarget(1, "ArrowRight", read)).toBe(2);
    expect(keyTarget(2, "ArrowRight", read)).toBe(1); // tab 3 is closed, so wrap
    expect(keyTarget(1, "ArrowLeft", read)).toBe(2);
    expect(keyTarget(2, "ArrowRight", planned)).toBe(3);
    expect(keyTarget(3, "ArrowRight", planned)).toBe(1);
    expect(keyTarget(1, "ArrowLeft", planned)).toBe(3);
  });
  it("Home and End go to the first and last open tab", () => {
    expect(keyTarget(2, "Home", planned)).toBe(1);
    expect(keyTarget(1, "End", planned)).toBe(3);
    expect(keyTarget(1, "End", read)).toBe(2);
  });
  it("ignores other keys", () => {
    expect(keyTarget(1, "Enter", planned)).toBeNull();
    expect(keyTarget(1, "ArrowDown", planned)).toBeNull();
  });
});

describe("scrollTargetAfter", () => {
  it("desktop goes on to step 2 after a read", () => expect(scrollTargetAfter("read", false)).toBe(2));
  it("phones stay on step 1 after a read", () => expect(scrollTargetAfter("read", true)).toBeNull());
  it("both go to step 3 after a plan", () => {
    expect(scrollTargetAfter("plan", false)).toBe(3);
    expect(scrollTargetAfter("plan", true)).toBe(3);
  });
});
