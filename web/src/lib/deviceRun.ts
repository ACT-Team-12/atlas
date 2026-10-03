/**
 * State for "this device checked it too" in the care-plan screen.
 *
 * A finished run is stored by an opaque number naming the reading it belongs to, never by the reading itself: the
 * reading holds the person's whole paper (source_text), and React state outlives "Clear it from this device" unless
 * something empties it. The WeakMap below holds its keys weakly, so naming a reading does not keep it alive.
 */

export type DeviceVerdict = "match" | "differ" | "missing";
export type DeviceRun = { readonly run: number; readonly ok: boolean; readonly byId: Readonly<Record<string, DeviceVerdict>> };
export type DeviceStatus = "idle" | "loading" | "done" | "error";

/** No run yet (and the state after Clear). 0 is never a reading's id. */
export const NO_DEVICE_RUN: DeviceRun = { run: 0, ok: false, byId: {} };

const ids = new WeakMap<object, number>();
let nextId = 1;

/** The opaque id of one reading: the same for the same object, new for every other. */
export function runIdFor(reading: object): number {
  let id = ids.get(reading);
  if (id === undefined) {
    id = nextId++;
    ids.set(reading, id);
  }
  return id;
}

/** What the screen shows for the device check of `reading`, given the last finished run. */
export function deviceStatus(reading: { items: readonly unknown[] } | null, needsPhotoCheck: boolean, run: DeviceRun): DeviceStatus {
  if (!reading || needsPhotoCheck || reading.items.length === 0) return "idle";
  if (run.run !== runIdFor(reading)) return "loading";
  return run.ok ? "done" : "error";
}
