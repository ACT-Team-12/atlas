import { describe, expect, it } from "vitest";
import { hoursMatchQuote, quoteParts } from "./hoursQuote";
import type { Clinic, OpenPeriod } from "./resources";
import data from "@/data/resources.json";

const wk = (open: string, close: string, days = [0, 1, 2, 3, 4]): OpenPeriod[] => days.map((day) => ({ day, open, close }));

describe("hours quote check", () => {
  it("reads day ranges, single days and abbreviations", () => {
    expect([...quoteParts("Monday – Friday **Hours:** 7am – 5pm")[0].days]).toEqual([0, 1, 2, 3, 4]);
    expect(quoteParts("New Hours: Monday, 8 AM – 5 PM | Tuesday – Friday, 8 AM – 8 PM | Saturday, 8 AM – 5 PM.").map((p) => [...p.days])).toEqual([[0], [1, 2, 3, 4], [5]]);
    expect(quoteParts("MON 9:00 AM – 9:00 PM  TUE 9:00 AM – 5:00 PM  SAT & SUN Closed").map((p) => [...p.days])).toEqual([[0], [1], [5, 6]]);
    expect(quoteParts("2nd Friday of the Month").map((p) => [...p.days])).toEqual([[4]]);
  });

  it("accepts real quotes in their usual formats", () => {
    expect(hoursMatchQuote("Monday – Friday  **Hours:** 7am – 5pm", wk("07:00", "17:00")).ok).toBe(true);
    expect(hoursMatchQuote("Monday – Friday  **Hours:** 8am -4:30pm", wk("08:00", "16:30")).ok).toBe(true);
    expect(hoursMatchQuote("Office Hours:  Monday - Friday  9AM-5PM", wk("09:00", "17:00")).ok).toBe(true);
    expect(hoursMatchQuote("**Hours:** Monday - Friday | 8:00 a.m. - 5:00 p.m.   Open late on Mondays until 9:00 p.m.",
      [{ day: 0, open: "08:00", close: "21:00" }, ...wk("08:00", "17:00", [1, 2, 3, 4])]).ok).toBe(true);
  });

  it("rejects fabricated tuples (Codex 2026-10-02: '1' inside '10', wrong weekday)", () => {
    expect(hoursMatchQuote("Monday 10 AM to 5 PM", [{ day: 1, open: "01:00", close: "17:00" }]).ok).toBe(false);
    expect(hoursMatchQuote("Monday 10 AM to 5 PM", [{ day: 0, open: "01:00", close: "17:00" }]).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8:00 AM - 5:00 PM", [...wk("08:00", "17:00"), { day: 5, open: "08:00", close: "17:00" }]).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8:00 AM - 5:00 PM", wk("08:00", "19:30")).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8:00 AM - 5:00 PM", wk("20:00", "17:00")).ok).toBe(false);
  });

  it("handles the cases a second review found (Grok 2026-10-02)", () => {
    expect([...quoteParts("Saturday - Monday 9am - 5pm")[0].days].sort()).toEqual([0, 5, 6]);
    expect(hoursMatchQuote("Saturday - Monday 9am - 5pm", wk("09:00", "17:00", [5, 6, 0])).ok).toBe(true);
    expect(hoursMatchQuote("Monday - Friday 8am - 5pm. Wednesday closed.", wk("08:00", "17:00", [2])).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8am - 5pm. Open late on Mondays until 9pm.", wk("08:00", "17:00", [0])).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8am - 5pm. Open late on Mondays until 9pm.", [{ day: 0, open: "08:00", close: "21:00" }]).ok).toBe(true);
    expect(hoursMatchQuote("Open thus: 9am - 5pm", wk("09:00", "17:00", [3])).ok).toBe(false);
    expect(hoursMatchQuote("Thursdays 9am - 5pm", wk("09:00", "17:00", [3])).ok).toBe(true);
    expect(hoursMatchQuote("8am - 5pm Monday - Friday", wk("08:00", "17:00")).ok).toBe(true);
    expect(hoursMatchQuote("Monday - Friday 8-5pm", wk("08:00", "17:00")).ok).toBe(true);
    expect(hoursMatchQuote("Monday - Friday 5-8pm", wk("05:00", "20:00")).ok).toBe(false);
    // Codex re-check of those fixes
    expect(hoursMatchQuote("Monday - Friday 8am - 5pm. Wednesday closed; calls answered until 5pm.", [{ day: 2, open: "08:00", close: "17:00" }]).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8am - 5pm. Wednesday 10am - 3pm.", [{ day: 2, open: "08:00", close: "15:00" }]).ok).toBe(false);
    expect(hoursMatchQuote("Monday - Friday 8am - 5pm. Wednesday 10am - 3pm.", [{ day: 2, open: "10:00", close: "15:00" }]).ok).toBe(true);
  });

  it("every clinic shown with hours from its own site passes this check (guards the shipped data)", () => {
    const site = (data.clinics as unknown as Clinic[]).filter((c) => c.hours_source_id === "clinic-site");
    expect(site.length).toBeGreaterThanOrEqual(10);
    for (const c of site) expect({ name: c.name, ...hoursMatchQuote(c.hours_quote!, c.hours!) }).toEqual({ name: c.name, ok: true });
  });
});
