/**
 * Reading a pasted paper: over the stream first, and once more the plain way only when the stream broke.
 *
 * The retry sends the whole paper again, so it must not happen for a read that is no longer wanted: "Clear it from
 * this device" (or deleting the open plan) aborts the read's signal, and a newer read or a reset makes `current()`
 * false. Either way the paper is not sent a second time.
 */
import { StreamBroken } from "./extractEvents";

/** The read was cleared or replaced before it finished; the caller shows nothing for it. */
export class ReadCancelled extends Error {
  constructor() {
    super("This read was cleared or replaced.");
  }
}

export async function streamThenPlain<T>(
  stream: (signal: AbortSignal) => Promise<T>,
  plain: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  current: () => boolean,
  onBroken: () => void = () => {},
): Promise<T> {
  try {
    return await stream(signal);
  } catch (e) {
    if (!(e instanceof StreamBroken)) throw e;
    if (signal.aborted || !current()) throw new ReadCancelled();
    onBroken();
    return plain(signal);
  }
}
