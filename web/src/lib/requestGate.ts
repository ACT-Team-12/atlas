/**
 * Keeps a slow answer from landing on the wrong inputs. Each request gets a ticket with a generation number, an
 * AbortSignal and a copy of the inputs it was sent with. Any edit (new text, the sample, another language) calls
 * invalidate(), which aborts the request in flight and bumps the generation. An answer is committed only when its
 * ticket is still the current generation AND the inputs it was sent with still equal the inputs on screen.
 *
 * Pure, no React: unit tested in requestGate.test.ts.
 */
export type Ticket<I> = { gen: number; signal: AbortSignal; inputs: I };

export function createRequestGate<I extends Record<string, unknown>>() {
  let gen = 0;
  let ctrl: AbortController | null = null;
  return {
    /** Starts a request. Any earlier request is aborted and can no longer commit. */
    start(inputs: I): Ticket<I> {
      ctrl?.abort();
      ctrl = new AbortController();
      gen++;
      return { gen, signal: ctrl.signal, inputs: { ...inputs } };
    },
    /** Called on every edit to the inputs. The request in flight is aborted and can no longer commit. */
    invalidate() {
      ctrl?.abort();
      ctrl = null;
      gen++;
    },
    /** True only if this ticket is the latest one and was sent with exactly the inputs now on screen. */
    isCurrent(t: Ticket<I>, now: I): boolean {
      if (t.gen !== gen || t.signal.aborted) return false;
      const keys = new Set([...Object.keys(t.inputs), ...Object.keys(now)]);
      for (const k of keys) if (t.inputs[k] !== now[k]) return false;
      return true;
    },
  };
}
