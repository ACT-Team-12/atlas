import { PhiShield, unshieldDeep } from "./phiShield";
import { shieldFields, shieldText, unshieldCarePlan, unshieldExtractEvent, unshieldUnderstand } from "./phiResponses";
import type { CarePlanResponse, ExtractRequest } from "./schema";
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
 * The placeholder map lives in this request's memory only. Nothing here logs, stores or returns it.
 */

/** /api/extract: the paper is shielded, the read comes back on the original paper. */
export async function guardExtract(req: ExtractRequest, call: (req: ExtractRequest) => Promise<CarePlanResponse>): Promise<CarePlanResponse> {
  const session = new PhiShield();
  const ctx = req.text ? shieldText(session, req.text) : null;
  const plan = await call(ctx ? { ...req, text: ctx.result.text } : req);
  return unshieldCarePlan(plan, ctx, session.tokens);
}

/** /api/extract/stream: the shielded request, and an emit that puts the real words back into each event. */
export function guardExtractStream(req: ExtractRequest, emit: (e: ExtractEvent) => void): { req: ExtractRequest; emit: (e: ExtractEvent) => void; restore: (plan: CarePlanResponse) => CarePlanResponse } {
  const session = new PhiShield();
  const ctx = req.text ? shieldText(session, req.text) : null;
  return {
    req: ctx ? { ...req, text: ctx.result.text } : req,
    emit: (e) => emit(unshieldExtractEvent(e, ctx, session.tokens)),
    restore: (plan) => unshieldCarePlan(plan, ctx, session.tokens),
  };
}

/** /api/prep and /api/results: one paper in `text`; the answer only has strings to put back. */
export async function guardText<R extends { text: string }, T>(req: R, call: (req: R) => Promise<T>): Promise<T> {
  const session = new PhiShield();
  const ctx = shieldText(session, req.text);
  return unshieldDeep(await call({ ...req, text: ctx.result.text }), session.tokens);
}

/** /api/understand: the paper plus the steps; each proof span goes back onto the original paper. */
export async function guardUnderstand(req: UnderstandRequest, call: (req: UnderstandRequest) => Promise<UnderstandResponse>): Promise<UnderstandResponse> {
  const session = new PhiShield();
  const ctx = shieldText(session, req.source_text);
  const items = req.items.map((it) => shieldFields(session, it, ["title", "source_quote"]));
  return unshieldUnderstand(await call({ ...req, source_text: ctx.result.text, items }), ctx, session.tokens);
}

/** /api/meaning: the steps' quotes and explanations. */
export async function guardMeaning<T>(req: MeaningRequest, call: (req: MeaningRequest) => Promise<T>): Promise<T> {
  const session = new PhiShield();
  for (const it of req.items) for (const s of [it.source_quote, it.plain_language, it.when]) session.learn(s);
  const items = req.items.map((it) => shieldFields(session, it, ["source_quote", "plain_language", "when"]));
  return unshieldDeep(await call({ ...req, items }), session.tokens);
}

/**
 * /api/plan: the care steps and the person's note are shielded. The answer is NOT unshielded: the plan's text is what
 * the read-aloud voice (ElevenLabs) and the phone call (Vonage) say, so it must only ever hold words the AI wrote from
 * redacted text. plan.ts strips any placeholder from it, and the read-aloud signature covers exactly that text.
 */
export async function guardPlan<T>(req: PlanRequest, call: (req: PlanRequest) => Promise<T>): Promise<T> {
  const session = new PhiShield();
  for (const c of req.care) for (const s of [c.title, c.plain_language, c.when, c.source_quote]) session.learn(s);
  session.learn(req.note);
  const care = req.care.map((c) => shieldFields(session, c, ["title", "plain_language", "when", "source_quote"]));
  const note = session.shield(req.note).text;
  return call({ ...req, care, note });
}
