import { describe, expect, it } from "vitest";
import { bookableItem, bookingTarget, buildIcs, callScript, eventDescription, icsEscape, icsFold, type BookableItem } from "./booking";

const lab: BookableItem = { id: "c2", kind: "lab_test", title: "Fasting blood test", when: "within 2 weeks", source_quote: "Basic metabolic panel within 2 weeks; fasting." };
const a1c: BookableItem = { id: "c3", kind: "lab_test", title: "Hemoglobin A1c", when: "in 3 months", source_quote: "Hemoglobin A1c - due in 3 months" };
const referral: BookableItem = { id: "c4", kind: "referral", title: "Eye exam", when: "", source_quote: "Their office will call you to schedule. If you have not heard from them in 10 days, call 404-555-0134." };
const med: BookableItem = { id: "c1", kind: "medication", title: "Start metformin", when: "", source_quote: "metformin 500 mg twice daily" };

describe("bookableItem", () => {
  it("skips medicines and finds the lab", () => expect(bookableItem([med, lab])?.id).toBe("c2"));
  it("returns null when nothing needs booking", () => expect(bookableItem([med])).toBeNull());
});

describe("bookingTarget", () => {
  it("uses a phone number written in the paper's own line", () => {
    expect(bookingTarget(referral)).toEqual({ type: "paper", phone: "404-555-0134" });
    expect(bookingTarget({ ...referral, source_quote: "Call (470) 799.0044 to schedule" })?.phone).toBe("470-799-0044");
  });
  it("never invents a number: no number in the line means no call target (A1c regression, Codex 2026-10-02)", () => {
    expect(bookingTarget(a1c)).toBeNull();
    expect(bookingTarget(lab)).toBeNull();
  });
  it("does not mistake a dose or a date for a phone number", () => {
    expect(bookingTarget({ ...lab, source_quote: "Take 1 tablet 2 times a day for 1000 mg total, recheck 12/2026" })).toBeNull();
  });
});

describe("callScript", () => {
  it("quotes the paper and adds asks only for barriers the person picked", () => {
    const s = callScript(lab, ["schedule", "cost"], "Spanish").join(" ");
    expect(s).toContain('"Basic metabolic panel within 2 weeks; fasting."');
    expect(s).toContain("within 2 weeks");
    expect(s).toContain("worried about the cost");
    expect(s).toContain("evening or weekend");
    expect(s).not.toContain("interpreter");
  });
  it("asks for an interpreter only when language is a barrier and the language is not English", () => {
    expect(callScript(lab, ["language"], "Amharic").join(" ")).toContain("interpreter in Amharic");
    expect(callScript(lab, ["language"], "English").join(" ")).not.toContain("interpreter");
  });
  it("never adds a number that is not in its inputs", () => {
    const digits = callScript(lab, ["cost", "schedule", "transport", "referrals", "tech", "language"], "Spanish").join(" ").match(/\d+/g) ?? [];
    for (const d of digits) expect(lab.source_quote + lab.when).toContain(d);
  });
});

describe("calendar file", () => {
  it("escapes text values", () => expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne"));
  it("folds long lines at 75 octets without splitting characters", () => {
    const folded = icsFold("DESCRIPTION:" + "é".repeat(80));
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "é".repeat(80));
  });
  it("builds one event with two reminders and the paper quote", () => {
    const ics = buildIcs({ uid: "u1@atlas", start: new Date(2026, 9, 5, 9, 30), minutes: 60, title: referral.title,
      description: eventDescription(referral, bookingTarget(referral)), now: new Date(Date.UTC(2026, 9, 2, 12)) });
    expect(ics).toContain("DTSTART:20261005T093000");
    expect(ics).toContain("DTEND:20261005T103000");
    expect(ics).toContain("DTSTAMP:20261002T120000Z");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics.replace(/\r\n /g, "")).toContain("Number on your paper: 404-555-0134");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
