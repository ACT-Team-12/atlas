import { ItemScanner } from "./itemScanner";
import { ModelStep, finishPlan, groundStep, makePlanClient, planParams, type PlanContext, type PlanResponse } from "./plan";
import type { ModelStream } from "./extractStream";
import type { PlanEvent } from "./planEvents";

/**
 * Builds a plan while the model writes, sending each step as soon as it is safe to show.
 *
 * The verified resources go first (they are chosen before the AI is asked). A step is sent only when (1) its JSON
 * object is complete, (2) it passes the same schema check as the plain route, and (3) groundStep kept it: its ids were
 * checked against what we sent and removed from its text. The final plan is built by finishPlan, the same code as POST
 * /api/plan, so it is the only thing the client treats as final.
 */
export async function streamPlan(ctx: PlanContext, model: ModelStream, emit: (e: PlanEvent) => void): Promise<PlanResponse> {
  emit({ type: "start", resources: ctx.resources, located: ctx.located });
  const scanner = new ItemScanner("steps");
  for await (const chunk of model.text) {
    for (const raw of scanner.push(chunk)) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        continue; // the final check decides; never show what we could not parse
      }
      const s = ModelStep.safeParse(json);
      if (!s.success) continue;
      const step = groundStep(ctx, s.data);
      if (step) emit({ type: "step", step });
    }
  }
  const { parsed, stopReason } = await model.final();
  return finishPlan(ctx, parsed, stopReason);
}

/** Opens the real model stream with the same request as the plain route. */
export function openPlanStream(ctx: PlanContext, signal: AbortSignal): ModelStream {
  const stream = makePlanClient().messages.stream(planParams(ctx), { signal });
  return {
    text: (async function* () {
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
      }
    })(),
    final: async () => {
      const msg = await stream.finalMessage();
      return { parsed: msg.parsed_output, stopReason: msg.stop_reason };
    },
  };
}
