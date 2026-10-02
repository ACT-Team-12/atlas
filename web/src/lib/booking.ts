import type { Barrier } from "./resources";

/**
 * "Book it now": turns a plan step into the things a person needs to actually book it.
 *
 * No AI here. Everything shown is built from the paper's own quote, the "when" text the reader found,
 * and the barriers the person picked. Research behind it: staff scheduling predicted referral completion
 * (Forrest 2007), and getting an appointment, finding the office and office hours predicted a missed
 * referral (Zuckerman 2012).
 */

export const BOOKABLE_KINDS = ["lab_test", "referral", "follow_up_visit"] as const;

export type BookableItem = { id: string; kind: string; title: string; when: string; source_quote: string };
/** The only call target we show is a phone number written in the paper's own line for this step. */
export type BookingTarget = { type: "paper"; phone: string };

export function isBookable(kind: string) {
  return (BOOKABLE_KINDS as readonly string[]).includes(kind);
}

/** The first care item in the step that someone has to book (lab, referral, follow-up visit), or null. */
export function bookableItem(items: BookableItem[]): BookableItem | null {
  return items.find((i) => isBookable(i.kind)) ?? null;
}

/**
 * Who to call: a phone number written in the paper's own line for this step, or null.
 * The plan's clinics and programs help with barriers (cost, rides); they are not where this lab, referral
 * or follow-up gets booked, so they are never offered as the booking number (Codex review, 2026-10-02:
 * an A1c lab was paired with a financial-assistance line).
 */
// A phone number written the way people write one: "(404) 555-0134", "404-555-0134", "404.555.0134".
// A bare 10-digit run (an order number, an NPI) is not a phone number (Grok review, 2026-10-02).
const PHONE = /(?:\((\d{3})\)\s?|\b(\d{3})[\s.-])(\d{3})[\s.-](\d{4})\b/g;
// Numbers labeled like this are never the one to call.
const LABEL = /\b(fax|npi|mrn|order|rx|acct|account|member|id|policy)\b/i;

export function bookingTarget(item: BookableItem): BookingTarget | null {
  const q = item.source_quote;
  let prevEnd = 0;
  for (const m of q.matchAll(PHONE)) {
    // The label that belongs to THIS number: the text since the previous number or the start of its clause, and a
    // label right after it ("404-555-0199 (fax)"). (Codex re-check, 2026-10-02: suffix and long-prefix labels.)
    const clauseStart = Math.max(prevEnd, q.slice(0, m.index).search(/[.;|\n][^.;|\n]*$/) + 1);
    const before = q.slice(clauseStart, m.index);
    const after = q.slice(m.index! + m[0].length, m.index! + m[0].length + 16);
    prevEnd = m.index! + m[0].length;
    if (LABEL.test(before) || /^\s*[([]?\s*(fax|npi|mrn)\b/i.test(after)) continue;
    return { type: "paper", phone: `${m[1] ?? m[2]}-${m[3]}-${m[4]}` };
  }
  return null;
}

const ASK: Partial<Record<Barrier, string>> = {
  schedule: "Do you have early morning, evening or weekend times?",
  transport: "Which bus or train stop is closest to you?",
  referrals: "Do I need an order or a referral from my doctor for this, and do you already have it?",
  tech: "Can you call or text me a reminder instead of using an app?",
};

/**
 * A short script to read to the clinic. Every fact in it comes from the inputs:
 * the paper's quote, its "when" text and the person's barriers.
 */
export function callScript(item: BookableItem, barriers: Barrier[], language = "English"): string[] {
  const lines = [`Hi, I'm calling to book this: ${item.title}.`, `My paper from the clinic says: "${item.source_quote}"`];
  if (item.when.trim()) lines.push(`It says it should happen: ${item.when.trim()}.`);
  if (barriers.includes("cost") || barriers.includes("insurance")) lines.push("I'm worried about the cost. What would this cost me, and is there help with paying?");
  if (barriers.includes("language") && language !== "English") lines.push(`Can I have an interpreter in ${language}?`);
  for (const b of barriers) if (ASK[b]) lines.push(ASK[b]!);
  lines.push("Before I hang up, let me write down the date, the time, the address and what I should bring.");
  return lines;
}

// ---------- Calendar file (RFC 5545) ----------

/** Escape TEXT values: backslash, semicolon, comma, newline. */
export function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold content lines longer than 75 octets (UTF-8), continuing with CRLF + space, without splitting a character. */
export function icsFold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let limit = 75;
  for (const ch of line) {
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
      limit = 74; // continuation lines start with a space
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Floating local time (no time zone), so 9:00 means 9:00 wherever the phone is. */
export function icsLocal(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
export function icsUtc(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export type CalendarEvent = { uid: string; start: Date; minutes: number; title: string; location?: string; description: string; now?: Date };

/** One event with two reminders: the day before and two hours before. */
export function buildIcs(e: CalendarEvent): string {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ATLAS Team 12//After-Visit Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtc(e.now ?? new Date())}`,
    `DTSTART:${icsLocal(e.start)}`,
    `DTEND:${icsLocal(end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    `DESCRIPTION:${icsEscape(e.description)}`,
    ...["-P1D", "-PT2H"].flatMap((t) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(e.title)}`, `TRIGGER:${t}`, "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** The calendar description: the paper's own words plus who to call, so the reminder carries the evidence. */
export function eventDescription(item: BookableItem, target: BookingTarget | null) {
  const parts = [`From your paper: "${item.source_quote}"`];
  if (item.when.trim()) parts.push(`When: ${item.when.trim()}`);
  if (target) parts.push(`Number on your paper: ${target.phone}`);
  parts.push("Made with ATLAS (atlas-team12.vercel.app). Not medical advice.");
  return parts.join("\n");
}
