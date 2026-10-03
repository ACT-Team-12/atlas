import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NO_DEVICE_RUN, deviceStatus, runIdFor, type DeviceRun } from "./deviceRun";

const care = (text: string) => ({ source_text: text, source_kind: "text" as const, items: [{ id: "item-0" }] });

/** Every value reachable from `v`, so a test can prove a stored run holds no object it was not built from. */
function reachable(v: unknown, out: unknown[] = []): unknown[] {
  out.push(v);
  if (v && typeof v === "object") for (const k of Object.keys(v)) reachable((v as Record<string, unknown>)[k], out);
  return out;
}

describe("on-device check state", () => {
  it("names each reading by an opaque id: stable for one reading, different for the next", () => {
    const a = care("Take 1 tablet daily.");
    const b = care("Take 1 tablet daily.");
    expect(runIdFor(a)).toBe(runIdFor(a));
    expect(runIdFor(a)).not.toBe(runIdFor(b));
    expect(typeof runIdFor(a)).toBe("number");
  });

  it("a finished run holds no copy of or reference to the paper", () => {
    const c = care("PATIENT-PAPER-MARKER Take 1 tablet daily.");
    const run: DeviceRun = { run: runIdFor(c), ok: true, byId: { "item-0": "match" } };
    expect(deviceStatus(c, false, run)).toBe("done");
    expect(JSON.stringify(run)).not.toContain("PATIENT-PAPER-MARKER");
    expect(reachable(run).some((v) => v === c || (typeof v === "object" && v !== null && "source_text" in v))).toBe(false);
  });

  it("after Clear the state is the empty run, and a new reading shows loading, not the old verdicts", () => {
    const old = care("old paper");
    expect(deviceStatus(old, false, { run: runIdFor(old), ok: true, byId: { "item-0": "match" } })).toBe("done");
    expect(NO_DEVICE_RUN).toEqual({ run: 0, ok: false, byId: {} });
    expect(deviceStatus(null, false, NO_DEVICE_RUN)).toBe("idle");
    expect(deviceStatus(care("new paper"), false, NO_DEVICE_RUN)).toBe("loading");
    expect(deviceStatus(old, false, { run: runIdFor(old), ok: false, byId: {} })).toBe("error");
    expect(deviceStatus(old, true, NO_DEVICE_RUN)).toBe("idle");
    expect(deviceStatus({ ...old, items: [] }, false, NO_DEVICE_RUN)).toBe("idle");
  });

  it("CarePlanTool stores only the run id, and Clear (resetTool) empties it", () => {
    const src = readFileSync(new URL("../ui/CarePlanTool.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/for:\s*care\b/);
    expect(src).toMatch(/useState<DeviceRun>\(NO_DEVICE_RUN\)/);
    const reset = src.slice(src.indexOf("function resetTool()"), src.indexOf("\n  }\n", src.indexOf("function resetTool()")));
    expect(reset).toContain("setDeviceRun(NO_DEVICE_RUN)");
  });
});
