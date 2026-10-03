/**
 * The second-model meaning check, run from the browser, fenced to the read it belongs to.
 *
 * Each check gets its own run id and AbortController. Starting a new check, Clear, Delete of the open plan, opening
 * another plan and leaving the page all cancel the current run: its request (and, through /api/meaning, the model
 * call) is aborted, and its reply is never applied. Only a reply whose run id is still current reaches the screen,
 * so an older reply can never show its verdicts (keyed by ids like "item-0") beside a newer paper.
 */
import type { VerifiedItem } from "./schema";
import type { MeaningResponse } from "./meaning";
import type { ShareMeaning } from "./shareText";

export type MeaningState = ShareMeaning;

export const IDLE_MEANING: MeaningState = { status: "idle", byId: {} };

/** A monotonically increasing run id plus the AbortController of the run in flight. */
export class RunFence {
  private id = 0;
  private ac: AbortController | null = null;

  /** Cancels the run in flight (if any) and starts a new one. */
  start(): { id: number; signal: AbortSignal } {
    this.cancel();
    const ac = new AbortController();
    this.ac = ac;
    return { id: this.id, signal: ac.signal };
  }

  /** Cancels the run in flight: its request is aborted and its result will never be applied. */
  cancel(): void {
    this.id++;
    this.ac?.abort();
    this.ac = null;
  }

  isCurrent(id: number): boolean {
    return id === this.id;
  }
}

export type MeaningBody = { items: { id: string; plain_language: string; when: string; source_quote: string }[] };
export type PostMeaning = (body: MeaningBody, signal: AbortSignal) => Promise<{ ok: boolean; json: MeaningResponse }>;

/** The browser's request to /api/meaning. */
export const fetchMeaning: PostMeaning = async (body, signal) => {
  const res = await fetch("/api/meaning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  return { ok: res.ok, json: await res.json() };
};

/** Runs one meaning check for `items` and applies its state only while the run is still current. */
export async function runMeaningCheck(fence: RunFence, items: VerifiedItem[], post: PostMeaning, apply: (s: MeaningState) => void): Promise<void> {
  const run = fence.start();
  if (items.length === 0) return apply(IDLE_MEANING);
  apply({ status: "loading", byId: {} });
  try {
    const body = { items: items.slice(0, 40).map(({ id, plain_language, when, source_quote }) => ({ id, plain_language, when, source_quote })) };
    const { ok, json } = await post(body, run.signal);
    if (!fence.isCurrent(run.id)) return; // cleared, deleted or replaced meanwhile
    if (!ok) throw new Error();
    apply({ status: "done", byId: Object.fromEntries(json.results.map((r) => [r.id, r])) });
  } catch {
    if (fence.isCurrent(run.id)) apply({ status: "error", byId: {} });
  }
}
