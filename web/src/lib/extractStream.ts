import { CareItemSchema, type CarePlanResponse, type ExtractRequest } from "./schema";
import { buildParams, finishCarePlan, makeClient } from "./extract";
import { ItemScanner } from "./itemScanner";
import { verifyItem } from "./verify";
import type { ExtractEvent } from "./extractEvents";

/** What the model stream gives us: text as it is written, then the finished message. */
export type ModelStream = {
  text: AsyncIterable<string>;
  final: () => Promise<{ parsed: unknown; stopReason: string | null | undefined }>;
};

/**
 * Reads a paper while the model writes, sending each step as soon as it is safe to show.
 *
 * A step is sent only when (1) its JSON object is complete, (2) it passes the same schema check
 * as the plain route, and (3) our code found its quote in the person's own text. Photos send no
 * steps early: their quotes are checked against the AI's reading of the photo, which the person
 * has to check first. The final result is built by finishCarePlan, the same code as POST
 * /api/extract, so it is the only thing the client treats as final.
 */
export async function streamCarePlan(
  req: ExtractRequest,
  model: ModelStream,
  emit: (e: ExtractEvent) => void,
  t0: number,
): Promise<CarePlanResponse> {
  const scanner = new ItemScanner();
  const source = req.text;
  let index = 0;
  for await (const chunk of model.text) {
    for (const raw of scanner.push(chunk)) {
      const i = index++;
      if (!source) continue;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        continue; // the final check decides; never show what we could not parse
      }
      const item = CareItemSchema.safeParse(json);
      if (!item.success) continue;
      const v = verifyItem(source, item.data, i);
      if (v.grounded) emit({ type: "item", item: v });
    }
  }
  const { parsed, stopReason } = await model.final();
  return finishCarePlan(req, parsed, stopReason, t0);
}

/** Opens the real model stream with the same request as the plain route. */
export function openModelStream(req: ExtractRequest, signal: AbortSignal): ModelStream {
  const client = makeClient();
  const stream = client.messages.stream(buildParams(req), { signal });
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
