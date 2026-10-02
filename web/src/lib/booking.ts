import type { Barrier, Clinic, Program } from "./resources";

/**
 * "Book it now": turns a plan step into the things a person needs to actually book it.
 *
 * No AI here. Everything shown is built from the paper's own quote, the "when" text the reader found,
 * the barriers the person picked, and the verified clinic or program record. Research behind it:
 * staff scheduling predicted referral completion (Forrest 2007), and getting an appointment, finding
 * the office and office hours predicted a missed referral (Zuckerman 2012).
 */

export const BOOKABLE_KINDS = ["lab_test", "referral", "follow_up_visit"] as const;

export type BookableItem = { id: string; kind: string; title: string; when: string; source_quote: string };
export type BookingTarget =
  | { type: "clinic"; name: string; phone: string; address: string; hours_per_week: number | null }
  | { type: "program"; name: string; phone: string };

export function isBookable(kind: string) {
  return (BOOKABLE_KINDS as readonly string[]).includes(kind);
}

/** The first care item in the step that someone has to book (lab, referral, follow-up visit), or null. */
export function bookableItem(items: BookableItem[]): BookableItem | null {
  return items.find((i) => isBookable(i.kind)) ?? null;
}

/** Who to call: a verified clinic first, then a verified program with a phone number. Never invented. */
export function bookingTarget(resources: Array<{ type: "clinic"; clinic: Clinic } | { type: "program"; program: Program }>): BookingTarget | null {
  for (const r of resources) if (r.type === "clinic" && r.clinic.phone)
    return { type: "clinic", name: r.clinic.name, phone: r.clinic.phone, address: `${r.clinic.address}, ${r.clinic.city}, GA ${r.clinic.zip}`, hours_per_week: r.clinic.hours_per_week };
  for (const r of resources) if (r.type === "program" && r.program.access.phone)
    return { type: "program", name: r.program.name, phone: r.program.access.phone };
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
 * the paper's quote, its "when" text, the person's barriers and the verified target.
 */
export function callScript(item: BookableItem, barriers: Barrier[], target: BookingTarget | null, language = "English"): string[] {
  const lines = [`Hi, I'm calling to book this: ${item.title}.`, `My paper from the clinic says: "${item.source_quote}"`];
  if (item.when.trim()) lines.push(`It says it should happen: ${item.when.trim()}.`);
  if (barriers.includes("cost") || barriers.includes("insurance")) {
    // Health centers in our list are HRSA-funded, and HRSA requires fees adjusted to income (sourced in resources.json).
    lines.push(target?.type === "clinic"
      ? "I'm worried about the cost. Can you tell me what I'd pay with the sliding fee for my income?"
      : "I'm worried about the cost. What would this cost me, and is there help with paying?");
  }
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
  if (target) parts.push(`${target.name}: ${target.phone}`);
  parts.push("Made with ATLAS (atlas-team12.vercel.app). Not medical advice.");
  return parts.join("\n");
}
