/**
 * Picking a time for "Book it now" without the browser's date-time popup (Akhil, 2026-10-02: it covered the
 * panel and opened on the current minute). Pure helpers so the picker and the calendar links are testable.
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * `locale` is the page language's HTML code (lib/uiText.ts UI_LANG_CODE); English keeps its exact wording. Other
 * languages use the browser's own words for "today", "tomorrow", weekdays, dates and times (Intl), so no line here
 * needs a machine draft (Codex review of PR 93).
 */
const isEnglish = (locale: string) => locale === "en" || locale === "en-US";
const relDay = (locale: string, n: number) => {
  const s = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day");
  return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
};

/** Today and the next n-1 days, labeled the way people say them. */
export function dayOptions(now: Date, n = 14, locale = "en-US"): { value: string; label: string; sub: string }[] {
  const out = [];
  const loc = isEnglish(locale) ? "en-US" : locale;
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const weekday = d.toLocaleDateString(loc, { weekday: "short" });
    const date = d.toLocaleDateString(loc, { month: "short", day: "numeric" });
    const label = i > 1 ? weekday : isEnglish(locale) ? (i === 0 ? "Today" : "Tomorrow") : relDay(loc, i);
    out.push({ value: isoDay(d), label, sub: date });
  }
  return out;
}

/** Common appointment times, shown as one-tap chips. */
export const TIME_CHIPS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"] as const;

/** Every 15 minutes from 6:00 AM to 9:45 PM, for "Other time". */
export function timeOptions(): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m < 22 * 60; m += 15) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}

export function formatTime(hhmm: string, locale = "en-US") {
  const [h, m] = hhmm.split(":").map(Number);
  if (!isEnglish(locale)) return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

/** Local date + "HH:MM" -> Date in the person's own time zone. null if either part is missing or invalid. */
export function localStart(day: string, time: string): Date | null {
  const dm = day.match(/^(\d{4})-(\d{2})-(\d{2})$/), tm = time.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function describeStart(d: Date, locale = "en-US") {
  if (!isEnglish(locale)) return d.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}

const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

/**
 * A Google Calendar "add event" link with everything filled in. Times are written as local wall-clock time
 * with ctz set to the person's own time zone, so 9:00 stays 9:00.
 */
export function googleCalendarUrl(e: { title: string; start: Date; minutes: number; details: string; timeZone: string }) {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${stamp(e.start)}/${stamp(end)}`, details: e.details, ctz: e.timeZone });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
