import { describe, expect, it } from "vitest";
import { bookableItem, bookingTarget, buildIcs, callScript, eventDescription, icsEscape, icsFold, type BookableItem } from "./booking";
import type { Clinic, Program } from "./resources";

const lab: BookableItem = { id: "c2", kind: "lab_test", title: "Fasting blood test", when: "within 2 weeks", source_quote: "Basic metabolic panel within 2 weeks; fasting." };
const med: BookableItem = { id: "c1", kind: "medication", title: "Start metformin", when: "", source_quote: "metformin 500 mg twice daily" };
const clinic = { id: "x", name: "Test Health Center", address: "1 Main St", city: "Decatur", zip: "30030", phone: "404-555-0100", hours_per_week: 40 } as unknown as Clinic;
const program = { id: "p", name: "211", access: { phone: "211" } } as unknown as Program;

describe("bookableItem", () => {
  it("skips medicines and finds the lab", () => expect(bookableItem([med, lab])?.id).toBe("c2"));
  it("returns null when nothing needs booking", () => expect(bookableItem([med])).toBeNull());
});

describe("bookingTarget", () => {
  it("prefers a verified clinic over a program", () => {
    const t = bookingTarget([{ type: "program", program }, { type: "clinic", clinic }]);
    expect(t).toMatchObject({ type: "clinic", phone: "404-555-0100", address: "1 Main St, Decatur, GA 30030" });
  });
  it("falls back to a program with a phone, else null", () => {
    expect(bookingTarget([{ type: "program", program }])?.phone).toBe("211");
    expect(bookingTarget([])).toBeNull();
  });
});

describe("callScript", () => {
  it("quotes the paper and adds asks only for barriers the person picked", () => {
    const s = callScript(lab, ["schedule", "cost"], bookingTarget([{ type: "clinic", clinic }]), "Spanish");
    expect(s.join(" ")).toContain('"Basic metabolic panel within 2 weeks; fasting."');
    expect(s.join(" ")).toContain("within 2 weeks");
    expect(s.join(" ")).toContain("sliding fee");
    expect(s.join(" ")).toContain("evening or weekend");
    expect(s.join(" ")).not.toContain("interpreter");
  });
  it("asks for an interpreter only when language is a barrier and the language is not English", () => {
    expect(callScript(lab, ["language"], null, "Amharic").join(" ")).toContain("interpreter in Amharic");
    expect(callScript(lab, ["language"], null, "English").join(" ")).not.toContain("interpreter");
  });
  it("never adds a number that is not in its inputs", () => {
    const digits = callScript(lab, ["cost", "schedule", "transport", "referrals", "tech", "language"], null, "Spanish").join(" ").match(/\d+/g) ?? [];
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
    const ics = buildIcs({ uid: "u1@atlas", start: new Date(2026, 9, 5, 9, 30), minutes: 60, title: lab.title, location: "1 Main St, Decatur, GA 30030",
      description: eventDescription(lab, bookingTarget([{ type: "clinic", clinic }])), now: new Date(Date.UTC(2026, 9, 2, 12)) });
    expect(ics).toContain("DTSTART:20261005T093000");
    expect(ics).toContain("DTEND:20261005T103000");
    expect(ics).toContain("DTSTAMP:20261002T120000Z");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain("LOCATION:1 Main St\\, Decatur\\, GA 30030");
    expect(ics.replace(/\r\n /g, "")).toContain("Basic metabolic panel within 2 weeks\\; fasting.");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
