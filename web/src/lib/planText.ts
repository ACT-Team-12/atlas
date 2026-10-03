import type { PlanResponse } from "./plan";

/**
 * Internal ids never reach the person. The plan model is given care steps and resources WITH ids ("item-4",
 * "grady-financial-assistance") so it can link them in care_ids and resource_ids, and sometimes it also writes them
 * into its prose: a live plan said "the fasting blood test within 2 weeks (item-4), the eye doctor visit (item-5)".
 * The prompt asks it not to (plan.ts SYSTEM), but a prompt is not a guarantee, so this filter runs on every free-text
 * field of every plan (buildPlan, and a plan restored from this device) and so on everything made from those fields:
 * the screen, read aloud, the phone call, share, print and the handoff sheet.
 *
 * What is removed: a known id, or anything shaped like a care id ("item-12"), together with a "care id" / "ID" label
 * before it, and a bracket that held nothing else. Only id-shaped tokens are ever removed (no spaces, and a hyphen,
 * underscore or digit in them), so an id that happens to be a plain word can never delete that word from a sentence.
 */
const CARE_ID = String.raw`item-\d+`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idShaped = (id: string) => /^[\p{L}\p{N}_-]{2,80}$/u.test(id) && /[-_\d]/.test(id);

/** A label the model puts before an id: "care id", "resource ID", "id", "ids", "#". */
const LABEL = String.raw`(?<![\p{L}\p{N}])(?:(?:care|resource|step)[ \t]+)?ids?[ \t]*[:#]?[ \t]*`;
/** What may separate several ids inside one bracket ("and" in the plan languages, or punctuation). */
const JOIN = String.raw`[ \t]*(?:,|;|/|&|、|和|与|및|(?<![\p{L}])(?:and|y|et|và)(?![\p{L}]))[ \t]*`;

function idPattern(ids: Iterable<string>): string {
  const known = [...new Set([...ids].filter(idShaped))].sort((a, b) => b.length - a.length).map(escape);
  return `(?:${[CARE_ID, ...known].join("|")})`;
}

/** Removes internal ids from one piece of plan text. `ids` are the plan's own care and resource ids. */
export function stripIds(text: string, ids: Iterable<string> = []): string {
  if (!text) return text;
  const id = `(?<![\\p{L}\\p{N}_-])${idPattern(ids)}(?![\\p{L}\\p{N}_-])`;
  const one = `(?:${LABEL})?${id}`;
  // 1. A bracket holding only ids (and labels and joins), with the space before it: "test (item-4)." -> "test."
  let out = text.replace(new RegExp(`[ \\t]*[(\\[（]\\s*${one}(?:${JOIN}${one})*\\s*[)\\]）]`, "giu"), "");
  // 2. Any id left anywhere else, with its label: "see care id item-4 on your paper" -> "see on your paper".
  out = out.replace(new RegExp(`[ \\t]*${one}`, "giu"), "");
  if (out === text) return text;
  // 3. Tidy what the removal left: empty or dangling brackets, a join left at either end of a bracket, doubled spaces,
  //    a space before punctuation.
  return out
    .replace(new RegExp(`([(\\[（])\\s*(?:${JOIN})+`, "gu"), "$1")
    .replace(new RegExp(`(?:${JOIN})+\\s*([)\\]）])`, "gu"), "$1")
    .replace(/[ \t]*[(\[（]\s*[)\]）]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?。、，])/gu, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

type PlanText = Pick<PlanResponse, "summary" | "steps" | "ask_a_person_reason"> & Partial<Pick<PlanResponse, "resources">>;

/** Every id a plan knows about: its resources and every id its steps link (kept or dropped). */
export function planIds(plan: PlanText): string[] {
  return [
    ...Object.keys(plan.resources ?? {}),
    ...plan.steps.flatMap((s) => [...(s.care_ids ?? []), ...(s.resource_ids ?? []), ...(s.dropped_refs ?? [])]),
  ];
}

/**
 * The plan with ids removed from every free-text field (summary, each step's title, action and why, and the reason to
 * ask a person). Returns the SAME object when nothing changed, so a clean plan keeps its speak token valid.
 */
export function cleanPlanText<T extends PlanText>(plan: T, extraIds: Iterable<string> = []): T {
  const ids = [...planIds(plan), ...extraIds];
  const s = (t: string) => stripIds(t, ids);
  const steps = plan.steps.map((st) => {
    const next = { ...st, title: s(st.title), action: s(st.action), why: s(st.why) };
    return next.title === st.title && next.action === st.action && next.why === st.why ? st : next;
  });
  const summary = s(plan.summary);
  const reason = s(plan.ask_a_person_reason);
  if (summary === plan.summary && reason === plan.ask_a_person_reason && steps.every((st, i) => st === plan.steps[i])) return plan;
  return { ...plan, summary, ask_a_person_reason: reason, steps };
}
