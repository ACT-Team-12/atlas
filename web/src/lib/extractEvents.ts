import type { CarePlanResponse, VerifiedItem } from "./schema";

/**
 * Events sent by POST /api/extract/stream, one JSON object per line (NDJSON).
 * - "item": one care step, sent only after it is complete AND its quote was found in the paper.
 * - "done": the full result, exactly the body POST /api/extract returns. Only this is final.
 * - "error": the read failed; `status` is what POST /api/extract would have answered.
 */
export type ExtractEvent =
  | { type: "item"; item: VerifiedItem }
  | { type: "done"; plan: CarePlanResponse }
  | { type: "error"; error: string; status: number };

export function encodeEvent(e: ExtractEvent): string {
  return JSON.stringify(e) + "\n";
}

/** The stream broke or ended without a result. The caller should retry with the plain route. */
export class StreamBroken extends Error {}

/** The server finished and said why the read failed. */
export class StreamFailed extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Reads an NDJSON event stream. Calls onItem for each verified step and resolves with the final
 * result. Throws StreamFailed when the server reports an error, StreamBroken for anything else
 * (cut connection, garbled line, stream ending before "done").
 */
export async function readExtractEvents(
  body: ReadableStream<Uint8Array>,
  onItem: (item: VerifiedItem) => void,
): Promise<CarePlanResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const handle = (line: string): CarePlanResponse | null => {
    if (!line.trim()) return null;
    let e: ExtractEvent;
    try {
      e = JSON.parse(line);
    } catch {
      throw new StreamBroken("Bad line in stream");
    }
    if (e.type === "item") { onItem(e.item); return null; }
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
