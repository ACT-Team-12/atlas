import type { VerifiedItem } from "./schema";
import type { PlanResponse } from "./plan";
import { BARRIER_LABEL, type Barrier } from "./resources";

/**
 * "For helpers: session summary": a documentation draft a community health worker or navigator copies or prints
 * into their own notes. It follows the items CMS and NACHC list for Community Health Integration and Principal
 * Illness Navigation records (upstream drivers, consent, action plan and goals, community services, education,
 * appointment help, time and who did it). It is a draft the helper and the billing practitioner review: it never
 * says anything is billable, and it carries no diagnosis codes (no ICD-10 Z code was checked against the official
 * FY2026 list, so none are added).
 *
 * Built on the device from what the screen already has. Pure: no network, no AI. It leaves out the paper's own words
 * (not even the quoted lines, which can carry a name, a date of birth or an address), the ZIP or location, and clinic
 * addresses. Every other exported text (titles, times, plan steps, the reason to ask a person, questions) has ZIP
 * codes and other runs of 5 or more digits masked. Only the helper's own free-text notes go in as typed.
 */

/** The headings, in order. English only: the app has no translation table for helper-facing text. */
export const SESSION_HEADINGS = [
  "Upstream drivers the person picked",
  "Action plan (steps from the paper)",
  "Community resources in the plan",
  "Education topics in the plan",
  "Appointments on the paper",
  "Time by activity (minutes, total)",
  "Consent",
  "Helper notes",
] as const;

export const ACTIVITIES = ["explain", "barriers", "resources", "appointments"] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  explain: "Explaining the paper",
  barriers: "Barrier check",
  resources: "Finding resources",
  appointments: "Appointment help",
};

/** What the screen already has about the plan. */
export type SessionPlanState = {
  barriers: Barrier[];
  /** The care steps on screen (removed ones already left out). Only grounded steps are used. */
  items: VerifiedItem[];
  /** The person's own done ticks, by care step id. */
  done: Record<string, boolean>;
  plan: Pick<PlanResponse, "steps" | "resources" | "ask_a_person" | "ask_a_person_reason"> | null;
  questions: string[];
  language: string;
  readingLevel: string;
};

/** What the helper types into the panel. Minutes may be blank or text while typing. */
export type HelperEntry = {
  minutes: Partial<Record<Activity, number | string | null | undefined>>;
  notes: string;
  consentDiscussed: boolean;
};

export type SessionSection = { heading: (typeof SESSION_HEADINGS)[number]; lines: string[] };
export type SessionSummary = {
  sections: SessionSection[];
  minutes: Record<Activity, number>;
  totalMinutes: number;
  text: string;
};

export const SUMMARY_TITLE = "Helper session summary (draft)";
export const SUMMARY_FOOT =
  "Draft made with ATLAS for the helper's own notes. It lists what ATLAS showed; it does not say what the helper did, so add that in the notes. The helper and the clinic review it and decide what goes in a record.";

const APPOINTMENT_KINDS = new Set(["follow_up_visit", "referral", "lab_test"]);
const KIND_LABEL: Record<string, string> = {
  medication: "Medicine", lab_test: "Lab test", referral: "Referral", follow_up_visit: "Follow-up visit", self_care: "Self care", warning_sign: "Warning sign",
};

/** Whole minutes from 0 to 600. Blank, negative or not a number counts as 0. */
export function cleanMinutes(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(600, Math.round(n));
}

/** ZIP codes (with or without +4), record and account numbers: any run of 5 or more digits. Phone numbers keep their separators. */
const LONG_NUMBER = /\b\d{5,}(?:-\d{4})?\b/g;
export function maskNumbers(s: string): string {
  return s.replace(LONG_NUMBER, "[number removed]");
}

const tick = (on: boolean) => (on ? "[x] done" : "[ ] not done yet");

export function sessionSummary(state: SessionPlanState, helper: HelperEntry): SessionSummary {
  const grounded = state.items.filter((i) => i.grounded);
  const steps = state.plan?.steps ?? [];
  const minutes = Object.fromEntries(ACTIVITIES.map((a) => [a, cleanMinutes(helper.minutes[a])])) as Record<Activity, number>;
  const totalMinutes = ACTIVITIES.reduce((sum, a) => sum + minutes[a], 0);

  const drivers = state.barriers.map((b) => `- ${BARRIER_LABEL[b] ?? b}`);

  const title = (i: VerifiedItem) => `${KIND_LABEL[i.kind] ?? i.kind}: ${maskNumbers(i.title)}${i.when.trim() ? ` (${maskNumbers(i.when.trim())})` : ""}`;
  const action: string[] = grounded.map((i) => `- ${i.kind === "warning_sign" ? "" : `${tick(!!state.done[i.id])}: `}${title(i)}`);
  if (steps.length) {
    action.push("Goals suggested in the ATLAS plan (the paper wins if they differ):");
    steps.forEach((s, n) => action.push(`  ${n + 1}. ${maskNumbers(s.title)}`));
  }

  // Only resources a plan step points to, with name and phone. No addresses: a clinic's ZIP can point to where the person lives.
  const used = new Set(steps.flatMap((s) => s.resource_ids));
  const resources = Object.values(state.plan?.resources ?? {}).filter((r) => used.has(r.id)).map((r) => {
    if (r.type === "clinic") return `- ${r.clinic.name}${r.clinic.phone ? `: ${r.clinic.phone}` : ""} (health center)`;
    const a = r.program.access;
    return `- ${r.program.name}${a.phone ? `: ${a.phone}` : a.url ? `: ${a.url}` : ""} (program)`;
  });
  if (state.plan?.ask_a_person) resources.push(`- Needs a person too: ${maskNumbers(state.plan.ask_a_person_reason.trim()).replace(/\.+$/, "") || "no verified resource for every need"}. ATLAS suggested calling 211.`);

  const education: string[] = [];
  if (grounded.length) education.push(`- ${grounded.length} ${grounded.length === 1 ? "step" : "steps"} from the paper, explained in plain words by ATLAS (${state.language}, ${state.readingLevel} reading level).`);
  const warnings = grounded.filter((i) => i.kind === "warning_sign");
  if (warnings.length) education.push(`- Warning signs on the paper: ${warnings.map((w) => maskNumbers(w.title)).join("; ")}.`);
  for (const s of steps) if (s.barrier) education.push(`- ${BARRIER_LABEL[s.barrier as Barrier] ?? s.barrier}: ${maskNumbers(s.title)}`);
  if (state.questions.length) {
    education.push("- Questions to ask at the next visit:");
    state.questions.forEach((q) => education.push(`  - ${maskNumbers(q)}`));
  }

  const appointments = grounded.filter((i) => APPOINTMENT_KINDS.has(i.kind))
    .map((i) => `- ${tick(!!state.done[i.id])}: ${title(i)}`);

  const time = ACTIVITIES.map((a) => `- ${ACTIVITY_LABEL[a]}: ${minutes[a]} min`);
  time.push(`- Total: ${totalMinutes} min`, "- Done by: helper (add your name and role)");

  const sections: SessionSection[] = [
    { heading: SESSION_HEADINGS[0], lines: drivers.length ? drivers : ["- None picked"] },
    { heading: SESSION_HEADINGS[1], lines: action.length ? action : ["- No steps from the paper"] },
    { heading: SESSION_HEADINGS[2], lines: resources.length ? resources : ["- None in the plan"] },
    { heading: SESSION_HEADINGS[3], lines: education.length ? education : ["- None in the plan"] },
    { heading: SESSION_HEADINGS[4], lines: appointments.length ? appointments : ["- No appointments on the paper"] },
    { heading: SESSION_HEADINGS[5], lines: time },
    { heading: SESSION_HEADINGS[6], lines: [helper.consentDiscussed ? "- Consent discussed: yes" : "- Consent discussed: no"] },
    { heading: SESSION_HEADINGS[7], lines: helper.notes.trim() ? helper.notes.trim().split(/\r?\n/).map((l) => l.trimEnd()) : ["- None"] },
  ];

  const text = [SUMMARY_TITLE, ...sections.flatMap((s) => ["", s.heading, ...s.lines]), "", SUMMARY_FOOT].join("\n");
  return { sections, minutes, totalMinutes, text };
}

/**
 * React key for the helper panel. It holds minutes, notes and consent for ONE person's session, so it is tied to the
 * saved plan's own id as well as the plan: two saved plans with the same summary (the same sample paper, a standard
 * discharge sheet) must never share one helper's notes.
 */
export function helperSessionKey(savedPlanId: string | null, planSummary: string): string {
  return `helper:${savedPlanId ?? "unsaved"}:${planSummary}`;
}
