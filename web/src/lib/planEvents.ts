import type { PlanResponse, PlanStep, ResourceCard } from "./plan";
import { StreamBroken, StreamFailed } from "./extractEvents";

/**
 * Events sent by POST /api/plan/stream, one JSON object per line (NDJSON).
 * - "start": the verified resources and where they are for. Decided before the AI is asked, so nothing here is new.
 * - "step": one step, sent only after it is complete, its ids were checked against what we sent, and ids were
 *   removed from its text (groundStep, the same code the final plan uses).
 * - "done": the full plan, exactly the body POST /api/plan returns. Only this is final.
 * - "error": building failed; `status` is what POST /api/plan would have answered.
 */
export type PlanEvent =
  | { type: "start"; resources: Record<string, ResourceCard>; located: PlanResponse["located"] }
  | { type: "step"; step: PlanStep }
  | { type: "done"; plan: PlanResponse }
  | { type: "error"; error: string; status: number };

export function encodePlanEvent(e: PlanEvent): string {
  return JSON.stringify(e) + "\n";
}

export type PlanPreview = { resources: Record<string, ResourceCard>; located: PlanResponse["located"]; steps: PlanStep[] };

/**
 * Reads a plan event stream. Calls onPreview with everything shown so far (resources plus the steps checked so far)
 * and resolves with the final plan. Throws StreamFailed when the server reports an error, StreamBroken for anything
 * else (cut connection, garbled line, a step before "start", stream ending before "done").
 */
export async function readPlanEvents(body: ReadableStream<Uint8Array>, onPreview: (p: PlanPreview) => void): Promise<PlanResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let preview: PlanPreview | null = null;
  const handle = (line: string): PlanResponse | null => {
    if (!line.trim()) return null;
    let e: PlanEvent;
    try {
      e = JSON.parse(line);
    } catch {
      throw new StreamBroken("Bad line in stream");
    }
    if (e.type === "start") { preview = { resources: e.resources, located: e.located, steps: [] }; onPreview(preview); return null; }
    if (e.type === "step") {
      if (!preview) throw new StreamBroken("Step before start");
      preview = { ...preview, steps: [...preview.steps, e.step] };
      onPreview(preview);
      return null;
    }
    if (e.type === "done") return e.plan;
    if (e.type === "error") throw new StreamFailed(e.error, e.status);
    throw new StreamBroken("Unknown event");
  };
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new StreamBroken("Connection lost");
      }
      if (chunk.done) {
        pending += decoder.decode();
        const plan = handle(pending);
        if (plan) return plan;
        throw new StreamBroken("Stream ended early");
      }
      pending += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        const plan = handle(line);
        if (plan) return plan;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
