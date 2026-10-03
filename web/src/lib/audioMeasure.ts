/**
 * How long is this recording, measured from the file itself before anything is sent to a paid provider?
 *
 * The browser's Content-Type and the file's own timestamps are claims the sender controls, so neither is trusted.
 * The container is identified by its magic bytes, and the length is counted the way a decoder would play it:
 *   - WebM (Chrome, Firefox, Android): the Opus codec's own frame header in every block says how much audio it holds
 *     (2.5 to 120 ms), so the total is the sum over every block, whatever the timestamps say.
 *   - MP4 (Safari): AAC frames are 1,024 samples each at the sample rate in the codec config, so the total is the
 *     number of frames the sample tables list (plain or fragmented) times 1,024 over that rate.
 * Anything else, or anything this cannot read, is refused (null): a file we cannot measure is never sent.
 */
export type Container = "audio/webm" | "audio/mp4";
export type Measured = { container: Container; seconds: number };

export function sniffContainer(b: Uint8Array): Container | null {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "audio/mp4"; // "ftyp"
  return null;
}

export function measureAudio(b: Uint8Array): Measured | null {
  const container = sniffContainer(b);
  if (!container) return null;
  const seconds = container === "audio/webm" ? webmOpusSeconds(b) : mp4AacSeconds(b);
  return seconds === null || !Number.isFinite(seconds) ? null : { container, seconds };
}

// ---------- WebM / Matroska with Opus ----------
const MASTER = new Set([0x18538067, 0x1f43b675, 0xa0, 0x1654ae6b, 0xae]); // Segment, Cluster, BlockGroup, Tracks, TrackEntry
const SIMPLE_BLOCK = 0xa3, BLOCK = 0xa1, CODEC_ID = 0x86, TRACK_ENTRY = 0xae;

function vint(b: Uint8Array, pos: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || pos + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

/** Milliseconds of audio in one Opus packet, from its TOC byte (RFC 6716 section 3.1). */
export function opusPacketMs(p: Uint8Array): number | null {
  if (p.length < 1) return null;
  const config = p[0] >> 3, code = p[0] & 3;
  const size = config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  let frames = code === 0 ? 1 : code < 3 ? 2 : -1;
  if (code === 3) { if (p.length < 2) return null; frames = p[1] & 0x3f; }
  const ms = frames * size;
  return frames < 1 || ms > 120 ? null : ms;
}

function webmOpusSeconds(b: Uint8Array): number | null {
  let pos = 0, ms = 0, tracks = 0, opus = false;
  while (pos < b.length) {
    const id = vint(b, pos, true);
    if (!id) return null;
    const size = vint(b, pos + id.len, false);
    if (!size) return null;
    const data = pos + id.len + size.len;
    if (MASTER.has(id.value)) {
      if (id.value === TRACK_ENTRY) tracks++;
      pos = data; // step inside (works for live recordings whose Segment and Cluster sizes are "unknown")
      continue;
    }
    if (size.unknown) return null;
    const end = data + size.value;
    if (end > b.length) break; // a cut-off final element is not played either
    if (id.value === CODEC_ID) opus = new TextDecoder().decode(b.subarray(data, end)) === "A_OPUS";
    if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      const track = vint(b, data, false);
      if (!track) return null;
      const flags = b[data + track.len + 2];
      if (flags === undefined || flags & 0x06) return null; // laced blocks: not produced by browsers, refuse
      const packet = opusPacketMs(b.subarray(data + track.len + 3, end));
      if (packet === null) return null;
      ms += packet;
    }
    pos = end;
  }
  return tracks === 1 && opus ? ms / 1000 : null;
}

// ---------- MP4 with AAC ----------
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "moof", "traf", "mvex"]);
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function u32(b: Uint8Array, p: number) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
const fourcc = (b: Uint8Array, p: number) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

/** The AAC sample rate from an esds box's AudioSpecificConfig, or null. */
function aacRate(b: Uint8Array, start: number, end: number): number | null {
  for (let p = start; p < end - 1; p++) {
    if (b[p] !== 0x04) continue; // DecoderConfigDescriptor
    let q = p + 1, n = 0;
    while (q < end && b[q] & 0x80 && n < 3) { q++; n++; }
    q += 1 + 13; // length byte, then the fixed 13 bytes
    if (b[q] !== 0x05) continue; // DecoderSpecificInfo
    q++;
    n = 0;
    while (q < end && b[q] & 0x80 && n < 3) { q++; n++; }
    q++;
    if (q + 1 >= end) return null;
    const aot = b[q] >> 3, idx = ((b[q] & 7) << 1) | (b[q + 1] >> 7);
    if (aot === 0 || aot === 31 || idx >= AAC_RATES.length) return null;
    return AAC_RATES[idx];
  }
  return null;
}

function mp4AacSeconds(b: Uint8Array): number | null {
  let traks = 0, frames = 0, rate: number | null = null, aac = false;
  const walk = (start: number, end: number): boolean => {
    let p = start;
    while (p + 8 <= end) {
      let size = u32(b, p), head = 8;
      const type = fourcc(b, p + 4);
      if (size === 1) { if (p + 16 > end || u32(b, p + 8) !== 0) return false; size = u32(b, p + 12); head = 16; }
      else if (size === 0) size = end - p;
      if (size < head) return false;
      if (p + size > end) return type === "mdat"; // only the media payload may run past the end (a cut-off recording)
      const data = p + head, stop = p + size;
      if (type === "trak") traks++;
      if (CONTAINERS.has(type)) { if (!walk(data, stop)) return false; }
      else if (type === "stsd") {
        // fullbox(4) + entry_count(4), then one sample entry; an mp4a entry has 28 bytes before its child boxes.
        const entry = data + 8;
        if (fourcc(b, entry + 4) !== "mp4a") return false;
        aac = true;
        const esds = findBox(b, entry + 36, entry + u32(b, entry), "esds");
        rate = esds ? aacRate(b, esds.data + 4, esds.end) : null;
      } else if (type === "stsz") frames += u32(b, data + 8);
      else if (type === "trun") frames += u32(b, data + 4);
      p = stop;
    }
    return true;
  };
  if (!walk(0, b.length)) return null;
  return traks === 1 && aac && rate ? (frames * 1024) / rate : null;
}

function findBox(b: Uint8Array, start: number, end: number, want: string): { data: number; end: number } | null {
  let p = start;
  while (p + 8 <= end) {
    const size = u32(b, p);
    if (size < 8 || p + size > end) return null;
    if (fourcc(b, p + 4) === want) return { data: p + 8, end: p + size };
    p += size;
  }
  return null;
}
