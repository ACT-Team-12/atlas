"use client";

import { useEffect, useState } from "react";
import type { ParitySet } from "@/lib/deviceParity";

type Result = { status: "loading" } | { status: "error"; message: string } | { status: "done"; same: number; total: number; ms: number; differ: { quote: string }[] };

/**
 * Runs the WebAssembly checker in the visitor's browser over every eval case and counts how many spans are identical
 * to what the server's checker found when it rendered this page. Nothing here is precomputed for the browser side.
 */
export function DeviceParity({ set }: { set: ParitySet }) {
  const [r, setR] = useState<Result>({ status: "loading" });
  useEffect(() => {
    let live = true;
    import("@/lib/deviceChecker")
      .then(async ({ loadDeviceChecker, sameSpan }) => {
        const checker = await loadDeviceChecker();
        const t0 = performance.now();
        const differ = set.cases.filter((c) => !sameSpan(c.server, checker.findSpan(set.papers[c.paper], c.quote)));
        const ms = performance.now() - t0;
        if (live) setR({ status: "done", same: set.cases.length - differ.length, total: set.cases.length, ms, differ });
      })
      .catch((e: unknown) => { if (live) setR({ status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [set]);

  const found = set.cases.filter((c) => c.server !== null).length;
  return (
    <div className="mt-10">
      <div className="card p-6 bg-paper max-w-[40em]" role="status" aria-live="polite" data-device-parity={r.status}>
        {r.status === "loading" && <p className="display text-4xl">Running in your browser...</p>}
        {r.status === "error" && (
          <>
            <p className="display text-4xl">Couldn&apos;t run here</p>
            <p className="mt-2 font-semibold">This browser could not load the checker ({r.message}). The server&apos;s checker above still ran.</p>
          </>
        )}
        {r.status === "done" && (
          <>
            <p className="display text-5xl" data-testid="device-parity-count">{r.same}/{r.total}</p>
            <p className="mt-2 font-bold">identical: same words in the same place, or refused by both</p>
            <p className="mt-1 text-sm font-semibold text-ink-soft">
              Computed just now in this browser in {r.ms.toFixed(1)} ms. The server found {found} of the {r.total} quotes in their paper (the real
              instructions and non-instructions) and refused the other {r.total - found} (the planted fakes).
            </p>
          </>
        )}
      </div>
      {r.status === "done" && r.differ.length > 0 && (
        <div className="mt-6 card p-6 bg-red-soft">
          <p className="font-bold">Where this browser and the server disagree:</p>
          <ul className="mt-2 text-sm font-semibold list-disc pl-5">{r.differ.map((d, i) => <li key={i}>{d.quote}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
