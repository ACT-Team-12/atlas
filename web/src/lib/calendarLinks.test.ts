import { describe, expect, it } from "vitest";
import { dayOptions, describeStart, formatTime, googleCalendarUrl, localStart, timeOptions } from "./calendarLinks";

describe("calendar picker helpers", () => {
  it("labels today, tomorrow, then weekdays, across a month boundary", () => {
    const d = dayOptions(new Date(2026, 9, 30, 15, 0), 4);
    expect(d.map((x) => x.value)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(d.map((x) => x.label)).toEqual(["Today", "Tomorrow", "Sun", "Mon"]);
    expect(d[2].sub).toBe("Nov 1");
  });

  it("offers every 15 minutes from 6 AM to 9:45 PM and formats them", () => {
    const t = timeOptions();
    expect(t[0]).toBe("06:00");
    expect(t.at(-1)).toBe("21:45");
    expect(t).toHaveLength(64);
    expect(formatTime("13:30")).toBe("1:30 PM");
    expect(formatTime("00:15")).toBe("12:15 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
  });

  it("builds a local start time and refuses missing parts", () => {
    const s = localStart("2026-10-05", "09:30")!;
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes()]).toEqual([2026, 9, 5, 9, 30]);
    expect(localStart("", "09:30")).toBeNull();
    expect(localStart("2026-10-05", "")).toBeNull();
    expect(describeStart(s)).toBe("Mon, Oct 5 at 9:30 AM");
  });

  it("makes a Google Calendar link with local wall-clock times and the person's time zone", () => {
    const url = new URL(googleCalendarUrl({ title: "Fasting blood test", start: new Date(2026, 9, 5, 9, 30), minutes: 60, details: 'From your paper: "fasting, within 2 weeks"', timeZone: "America/New_York" }));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Fasting blood test");
    expect(url.searchParams.get("dates")).toBe("20261005T093000/20261005T103000");
    expect(url.searchParams.get("ctz")).toBe("America/New_York");
    expect(url.searchParams.get("details")).toContain("within 2 weeks");
  });
});
