import { ExtractError } from "./extract";
import { PhiShield, PhiShieldRefused, dropUnknownFor, unshieldDeep } from "./phiShield";
import { shieldFields, shieldText, unshieldCarePlan, unshieldExtractEvent, unshieldUnderstand } from "./phiResponses";
import { ITEM_KINDS, type CarePlanResponse, type ExtractRequest } from "./schema";
import type { ExtractEvent } from "./extractEvents";
import type { UnderstandRequest, UnderstandResponse } from "./understand";
import type { MeaningRequest } from "./meaning";
import type { PlanRequest } from "./plan";

/**
 * The server's net (phase 1 of the PHI shield). Every AI route runs the request through the same shield before the
 * model call, then puts the real words (and offsets) back before answering. The web page shields first and marks
 * its requests (SHIELD_HEADER); this pass then finds nothing new. The phone apps and older pages send raw text, and
 * this pass is what keeps the patient's identifiers away from the AI for them, with no app update.
 *
 * The page's SHIELD_HEADER is never trusted: this pass always runs over every field that reaches the AI, finds raw
 * identifiers whatever the header says, and keeps placeholders a page already made as they are.
 *
 * Fails closed: a text the shield cannot finish (PhiShieldRefused) refuses the request with a clear error (413) before
 * any AI call. A placeholder in the answer that this request neither made nor was sent (a model made it up) is
 * removed, never shown.
 *
 * The placeholder map lives in this request's memory only. Nothing here logs, stores or returns it.
 */

/** Runs the shielding step; a text that cannot be shielded in full refuses the request instead. */
function shieldOrRefuse<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof PhiShieldRefused) throw new ExtractError(e.message, 413);
    throw e;
  }
}

/** /api/extract: the paper is shielded, the read comes back on the original paper. */
export async function guardExtract(req: ExtractRequest, call: (req: ExtractRequest) => Promise<CarePlanResponse>): Promise<CarePlanResponse> {
  const session = new PhiShield();
  const ctx = shieldOrRefuse(() => (req.text ? shieldText(session, req.text) : null));
  const plan = await call(ctx ? { ...req, text: ctx.result.text } : req);
  return unshieldCarePlan(plan, ctx, session.tokens, dropUnknownFor(session));
}

/** /api/extract/stream: the shielded request, and an emit that puts the real words back into each event. */
export function guardExtractStream(req: ExtractRequest, emit: (e: ExtractEvent) => void): { req: ExtractRequest; emit: (e: ExtractEvent) => void; restore: (plan: CarePlanResponse) => CarePlanResponse } {
  const session = new PhiShield();
  const ctx = shieldOrRefuse(() => (req.text ? shieldText(session, req.text) : null));
  const drop = dropUnknownFor(session);
  return {
    req: ctx ? { ...req, text: ctx.result.text } : req,
    emit: (e) => emit(unshieldExtractEvent(e, ctx, session.tokens, drop)),
    restore: (plan) => unshieldCarePlan(plan, ctx, session.tokens, drop),
  };
}

/** /api/prep and /api/results: one paper in `text`; the answer only has strings to put back. */
export async function guardText<R extends { text: string }, T>(req: R, call: (req: R) => Promise<T>): Promise<T> {
  const session = new PhiShield();
  const ctx = shieldOrRefuse(() => shieldText(session, req.text));
  return unshieldDeep(await call({ ...req, text: ctx.result.text }), session.tokens, dropUnknownFor(session));
}

/**
 * A step's `id` (and `kind`) is a free string the client picks, and the AI is sent it. No pattern can tell a bare name
 * there ("Maria Lopez", with no label) from an id, so the AI never gets the client's id at all: each distinct id becomes
 * an opaque one (`atlas-step-1`...), a kind outside the fixed list is sent blank, and the real ids are put back into the
 * answer wherever a value is exactly an opaque id.
 */
export function opaqueSteps<T extends { id: string; kind?: string }>(items: readonly T[]): { items: T[]; restore: <R>(v: R) => R } {
  const toOpaque = new Map<string, string>();
  const toReal = new Map<string, string>();
  const out = items.map((it) => {
    let o = toOpaque.get(it.id);
    if (!o) { o = `atlas-step-${toOpaque.size + 1}`; toOpaque.set(it.id, o); toReal.set(o, it.id); }
    const kind = it.kind === undefined || (ITEM_KINDS as readonly string[]).includes(it.kind) ? it.kind : "";
    return { ...it, id: o, ...(it.kind === undefined ? {} : { kind }) };
  });
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return toReal.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { items: out, restore: <R>(v: R) => walk(v) as R };
}

/** /api/understand: the paper plus the steps; each proof span goes back onto the original paper. */
export async function guardUnderstand(req: UnderstandRequest, call: (req: UnderstandRequest) => Promise<UnderstandResponse>): Promise<UnderstandResponse> {
  const session = new PhiShield();
  const steps = opaqueSteps(req.items);
  const { ctx, items } = shieldOrRefuse(() => ({
    ctx: shieldText(session, req.source_text),
    items: steps.items.map((it) => shieldFields(session, it, ["title", "source_quote"])),
  }));
  return steps.restore(unshieldUnderstand(await call({ ...req, source_text: ctx.result.text, items }), ctx, session.tokens, dropUnknownFor(session)));
}

/** /api/meaning: the steps' quotes and explanations. */
export async function guardMeaning<T>(req: MeaningRequest, call: (req: MeaningRequest) => Promise<T>): Promise<T> {
  const session = new PhiShield();
  const steps = opaqueSteps(req.items);
  const items = shieldOrRefuse(() => {
    for (const it of steps.items) for (const s of [it.source_quote, it.plain_language, it.when]) session.learn(s);
    return steps.items.map((it) => shieldFields(session, it, ["source_quote", "plain_language", "when"]));
  });
  return steps.restore(unshieldDeep(await call({ ...req, items }), session.tokens, dropUnknownFor(session)));
}

/**
 * /api/plan: the care steps and the person's note are shielded. The answer is NOT unshielded: the plan's text is what
 * the read-aloud voice (ElevenLabs) and the phone call (Vonage) say, so it must only ever hold words the AI wrote from
 * redacted text. plan.ts strips any placeholder from it, and the read-aloud signature covers exactly that text.
 */
export async function guardPlan<T>(req: PlanRequest, call: (req: PlanRequest) => Promise<T>): Promise<T> {
  const session = new PhiShield();
  const steps = opaqueSteps(req.care);
  const { care, note } = shieldOrRefuse(() => {
    for (const c of steps.items) for (const s of [c.title, c.plain_language, c.when, c.source_quote]) session.learn(s);
    session.learn(req.note);
    return {
      care: steps.items.map((c) => shieldFields(session, c, ["title", "plain_language", "when", "source_quote"])),
      note: session.shield(req.note).text,
    };
  });
  // Only the step ids (exact opaque values, e.g. in care_ids) are put back; the plan's words are not unshielded.
  return steps.restore(await call({ ...req, care, note }));
}
