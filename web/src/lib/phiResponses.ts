import { PhiShield, rangeToOriginal, unshieldDeep, unshieldString, type ShieldResult } from "./phiShield";
import { missedLinesPayload } from "./missedLines";
import type { CarePlanResponse, VerifiedItem } from "./schema";
import type { ExtractEvent } from "./extractEvents";
import type { UnderstandResponse } from "./understand";

/**
 * Putting the real words back into what the AI routes answer, shared by the web page (shieldFetch.ts) and the
 * server's own net for clients that send raw text (the API routes). Pure: the original paper and the placeholder
 * map are passed in by whoever holds them, kept for one request (server) or one page (browser), never stored.
 *
 * The routes check every quote against the REDACTED paper, unchanged. Here the offsets they return are moved back
 * onto the original paper and every string gets its real words again, so "Show on my paper" and the missed-lines
 * check land on the same words they would have without the shield.
 */

/** One shielded paper: the original, what the AI saw, and how to map between them. */
export type ShieldContext = { original: string; result: ShieldResult };

/** Header a page sends when it already shielded the request. The server runs its own pass either way. */
export const SHIELD_HEADER = "x-atlas-shielded";

/** Shields one paper with the session's knowledge, keeping what is needed to map the answer back. */
export function shieldText(session: PhiShield, original: string): ShieldContext {
  session.learn(original);
  return { original, result: session.shield(original) };
}

/** Shields the named string fields of an object (a copy). Learns from them all first, so a name in one hides it in all. */
export function shieldFields<T extends Record<string, unknown>>(session: PhiShield, obj: T, keys: readonly (keyof T)[]): T {
  for (const k of keys) if (typeof obj[k] === "string") session.learn(obj[k] as string);
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) if (typeof obj[k] === "string") out[k as string] = session.shield(obj[k] as string).text;
  return out as T;
}

/** One care step, back on the original paper: real words in every string, the span moved, the quote re-read from the paper. */
export function unshieldItem(it: VerifiedItem, ctx: ShieldContext | null, tokens: ReadonlyMap<string, string>): VerifiedItem {
  const out = unshieldDeep(it, tokens);
  if (!ctx || !it.span) return out;
  const span = rangeToOriginal(ctx.result.offsetMap, it.span);
  out.span = span;
  // A kept step quotes the paper exactly (verify.ts slices it from the paper), so slicing the original gives the same
  // words with the hidden parts back in.
  if (it.grounded) out.source_quote = ctx.original.slice(span.start, span.end);
  return out;
}

/**
 * The whole read, back on the original paper. `ctx` is null for a photo read (nothing was shielded: the photo's
 * pixels went as they are); strings are still passed through unshieldString in case a field carries a placeholder.
 */
export function unshieldCarePlan(plan: CarePlanResponse, ctx: ShieldContext | null, tokens: ReadonlyMap<string, string>): CarePlanResponse {
  const items = plan.items.map((it) => unshieldItem(it, ctx, tokens));
  const refused = plan.refused.map((it) => unshieldItem(it, ctx, tokens));
  const textRead = ctx !== null && plan.source_kind === "text";
  const source_text = textRead && plan.source_text === ctx.result.text ? ctx.original : unshieldString(plan.source_text, tokens);
  const out: CarePlanResponse = {
    ...plan,
    source_text,
    items,
    refused,
    questions_for_doctor: plan.questions_for_doctor.map((q) => unshieldString(q, tokens)),
    not_in_document: plan.not_in_document.map((q) => unshieldString(q, tokens)),
  };
  if (plan.missed_lines) {
    // Rebuilt on the original paper from the moved spans: the same function the server runs, so the section reads
    // exactly as it would have with no shield (a placeholder never shifts a sentence or adds a "number" to cover).
    out.missed_lines = textRead && source_text === ctx.original ? missedLinesPayload(ctx.original, items) : unshieldDeep(plan.missed_lines, tokens);
  }
  return out;
}

/** One line of the /api/extract/stream answer, back on the original paper. */
export function unshieldExtractEvent(e: ExtractEvent, ctx: ShieldContext | null, tokens: ReadonlyMap<string, string>): ExtractEvent {
  if (e.type === "item") return { type: "item", item: unshieldItem(e.item, ctx, tokens) };
  if (e.type === "done") return { type: "done", plan: unshieldCarePlan(e.plan, ctx, tokens) };
  return e;
}

/** The teach-back quiz: real words in every string, each proof span moved onto the original paper. */
export function unshieldUnderstand(resp: UnderstandResponse, ctx: ShieldContext, tokens: ReadonlyMap<string, string>): UnderstandResponse {
  const out = unshieldDeep(resp, tokens);
  out.questions = resp.questions.map((q, i) => ({ ...out.questions[i], span: rangeToOriginal(ctx.result.offsetMap, q.span) }));
  return out;
}
