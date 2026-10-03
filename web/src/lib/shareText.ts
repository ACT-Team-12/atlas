import type { VerifiedItem } from "./schema";
import type { PlanResponse } from "./plan";
import type { MeaningResult } from "./meaning";
import { careStepView, checkOf, paperFirstLines } from "./paperFirst";
import { planStepQuotes } from "./planQuotes";

/** The second-model double-check, as the screen has it. "done" carries one result per item id. */
export type ShareMeaning = { status: "idle" | "loading" | "done" | "error"; byId: Record<string, MeaningResult> };

const KIND_LABEL: Record<string, string> = {
  medication: "Medicine", lab_test: "Lab test", referral: "Referral", follow_up_visit: "Follow-up visit", self_care: "Self care", warning_sign: "Warning sign",
};

/**
 * "Send to family": the plan as plain text for a text message or email, for the person who does the in-person care.
 * Asked for by a family caregiver on Oct 2 whose parents live in another state. Same content as the printed handoff
 * sheet: only grounded steps, each with the line from the paper, and phone numbers only from verified records.
 * Built on the device and handed to the phone's own share sheet; ATLAS never sees or stores it.
 * The double-check travels with it: an explanation is sent only when the second check certified it; otherwise the
 * paper's own words are sent in its place (paperFirst.ts), so a text message never carries an unchecked paraphrase.
 */
export function planShareText({ items, plan, questions, meaning, planItems }: { items: VerifiedItem[]; plan: PlanResponse; questions: string[]; meaning?: ShareMeaning; planItems?: VerifiedItem[] }): string {
  const out: string[] = ["Plan after the visit (from ATLAS)", "", `Suggestion from ATLAS, not the paper: ${plan.summary}`];

  const grounded = items.filter((i) => i.grounded);
  if (grounded.length) {
    out.push("", "WHAT THE PAPER SAYS TO DO");
    // Paper first (paperFirst.ts): the explanation travels only when certified; otherwise the paper's words do.
    grounded.forEach((i, n) => {
      const check = checkOf(meaning?.status === "done" ? meaning.byId[i.id] : undefined);
      out.push(`${n + 1}. ${KIND_LABEL[i.kind] ?? i.kind}${check === "certified" ? `: ${i.title}${i.when.trim() ? ` (${i.when.trim()})` : ""}` : ""}`);
      if (check === "flagged") out.push("   Double-check this one with your clinic: our second check found the explanation may not match the paper.");
      for (const l of paperFirstLines(careStepView(i, check))) out.push(`   ${l}`);
    });
  }

  if (plan.steps.length) {
    out.push("", "THE PLAN (suggestions from ATLAS; if anything differs from the paper, follow the paper)");
    plan.steps.forEach((s, n) => {
      out.push(`${n + 1}. ${s.title}. ${s.action}`);
      // Every step the plan was built from, even one removed from the list since: its quote never drops out.
      for (const q of planStepQuotes(s, planItems ?? grounded)) out.push(`   Your paper says: "${q}"`);
    });
  }

  const used = new Set(plan.steps.flatMap((s) => s.resource_ids));
  const help = Object.values(plan.resources).filter((r) => used.has(r.id));
  if (help.length) {
    out.push("", "WHO CAN HELP (checked numbers)");
    for (const r of help) {
      if (r.type === "clinic") out.push(`- ${r.clinic.name}: ${r.clinic.phone}, ${r.clinic.address}, ${r.clinic.city} ${r.clinic.zip}`);
      else {
        const a = r.program.access;
        out.push(`- ${r.program.name}${a.phone ? `: ${a.phone}` : ""}${a.text ? ` (${a.text})` : ""}${!a.phone && !a.text && a.url ? `: ${a.url}` : ""}`);
      }
    }
  }

  if (plan.ask_a_person) out.push("", `This needs a person too: ${plan.ask_a_person_reason} Call 211 or a community health worker.`);

  if (questions.length) {
    out.push("", "QUESTIONS FOR THE NEXT VISIT");
    questions.forEach((q) => out.push(`- ${q}`));
  }

  out.push("", "This explains the paper from the visit. It is not medical advice. If something feels urgent, call the clinic or 911.");
  return out.join("\n");
}

export const SHARE_TITLE = "Plan after the visit";
