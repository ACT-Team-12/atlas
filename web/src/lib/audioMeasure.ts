/**
 * How long is this recording, measured from the file itself before anything is sent to a paid provider?
 *
 * The browser's Content-Type and the file's own timestamps are claims the sender controls, so neither is trusted.
 * The container is identified by its magic bytes, and the length is counted the way a decoder would play it:
 *   - WebM (Chrome, Firefox, Android): the Opus codec's own frame header in every block says how much audio it holds
 *     (2.5 to 120 ms). The length is the longer of that sum and where the timeline ends (cluster timecode plus
 *     block offset, TimecodeScale must be the default 1 ms); a jump of over 2 s between blocks is refused.
 *   - MP4 (Safari): AAC frames are 1,024 samples each at the sample rate in the codec config, so the total is the
 *     number of frames the sample tables list (plain or fragmented) times 1,024 over that rate.
 * Anything else, or anything this cannot read, is refused (null): a file we cannot measure is never sent.
 *
 * Fail closed against parser differentials (security review, 2026-10-02): only one audio track; every element or
 * box must be one we know, in the place it belongs, inside its parent and the file, with nothing after the end;
 * no lacing, no edit list that repeats or skips media; and where two parts of the file disagree on length or
 * sample rate, the longer reading wins. Crafted files for each case are in __fixtures__/crafted-*.
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
const SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, BLOCK_GROUP = 0xa0, TRACKS = 0x1654ae6b, TRACK_ENTRY = 0xae;
const SIMPLE_BLOCK = 0xa3, BLOCK = 0xa1, CODEC_ID = 0x86, TRACK_NUMBER = 0xd7, TRACK_TYPE = 0x83, VOID = 0xec, ROOT = -1;
const INFO = 0x1549a966, TIMECODE_SCALE = 0x2ad7b1, CLUSTER_TIMECODE = 0xe7;
/** Browsers write timecodes in milliseconds (TimecodeScale 1,000,000 ns, the default). Any other scale is refused. */
const DEFAULT_TIMECODE_SCALE = 1_000_000;
/** A block may start at most this long after the previous one ended; a bigger gap (silence a decoder would play) is refused. */
const MAX_GAP_MS = 2_000;
const MASTERS = new Set([SEGMENT, CLUSTER, BLOCK_GROUP, TRACKS, TRACK_ENTRY]);
/** Every element we accept, and the one parent it may sit in. Anything else is refused. */
const WEBM_PARENT = new Map<number, number>([
  [0x1a45dfa3, ROOT], [SEGMENT, ROOT],
  [0x114d9b74, SEGMENT], [0x1549a966, SEGMENT], [TRACKS, SEGMENT], [0x1c53bb6b, SEGMENT], [0x1254c367, SEGMENT], [CLUSTER, SEGMENT],
  [TRACK_ENTRY, TRACKS],
  ...[TRACK_NUMBER, 0x73c5, 0x9c, 0x22b59c, 0x22b59d, 0x88, 0xb9, 0x55aa, CODEC_ID, 0x56aa, 0x56bb, TRACK_TYPE, 0xe1, 0x63a2, 0x536e, 0x23e383, 0x258688]
    .map((id) => [id, TRACK_ENTRY] as [number, number]),
  [0xe7, CLUSTER], [SIMPLE_BLOCK, CLUSTER], [BLOCK_GROUP, CLUSTER], [0xab, CLUSTER], [0xa7, CLUSTER],
  [BLOCK, BLOCK_GROUP], [0x9b, BLOCK_GROUP], [0x75a2, BLOCK_GROUP], [0xfb, BLOCK_GROUP],
]);

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

const uint = (b: Uint8Array, start: number, end: number) => { let v = 0; for (let i = start; i < end; i++) v = v * 256 + b[i]; return v; };

function webmOpusSeconds(b: Uint8Array): number | null {
  const stack: { id: number; end: number; unknown: boolean }[] = [{ id: ROOT, end: b.length, unknown: false }];
  let pos = 0, ms = 0, tracks = 0, opus = false, audio = false, trackNumber = -1, steps = 0;
  // The timeline: cluster timecode + signed block offset, in ms. Its end counts, not only the packets' sum.
  let clusterTc: number | null = null, timelineEnd = 0, lastEnd: number | null = null, scaleSeen = false;
  const blockTracks = new Set<number>();
  while (pos < b.length) {
    if (++steps > MAX_STEPS) return null;
    // Close every parent that ends here.
    while (stack.length > 1 && !stack[stack.length - 1].unknown && pos === stack[stack.length - 1].end) stack.pop();
    const id = vint(b, pos, true);
    if (!id) return null;
    const parent = WEBM_PARENT.get(id.value);
    if (parent === undefined && id.value !== VOID) return null; // an element we do not know
    // An unknown-size parent (a live Segment or Cluster) ends where an element of its own level or above begins.
    if (id.value !== VOID) {
      while (stack[stack.length - 1].id !== parent) {
        const top = stack.pop();
        if (!top || !top.unknown || stack.length === 0) return null; // misplaced element
      }
    }
    const size = vint(b, pos + id.len, false);
    if (!size) return null;
    const data = pos + id.len + size.len;
    const limit = stack[stack.length - 1].end;
    if (MASTERS.has(id.value)) {
      if (size.unknown && id.value !== SEGMENT && id.value !== CLUSTER) return null;
      const end = size.unknown ? limit : data + size.value;
      if (end > limit) return null;
      if (id.value === TRACK_ENTRY) tracks++;
      if (id.value === CLUSTER) clusterTc = null; // each cluster states its own timecode before any block
      stack.push({ id: id.value, end, unknown: size.unknown });
      pos = data;
      continue;
    }
    if (size.unknown) return null;
    const end = data + size.value;
    if (end > limit) return null; // runs past its parent or the file: a decoder may resync and play what follows
    if (id.value === CODEC_ID) opus = new TextDecoder().decode(b.subarray(data, end)) === "A_OPUS";
    if (id.value === TRACK_TYPE) audio = uint(b, data, end) === 2;
    if (id.value === TRACK_NUMBER) trackNumber = uint(b, data, end);
    if (id.value === INFO) {
      if (scaleSeen) return null; // one Info
      scaleSeen = true;
      const scale = infoTimecodeScale(b, data, end);
      if (scale !== DEFAULT_TIMECODE_SCALE) return null; // non-default, absurd, or unreadable
    }
    if (id.value === CLUSTER_TIMECODE) {
      if (clusterTc !== null || end - data > 8) return null;
      clusterTc = uint(b, data, end);
    }
    if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      const track = vint(b, data, false);
      if (!track) return null;
      blockTracks.add(track.value);
      const flags = b[data + track.len + 2];
      if (flags === undefined || flags & 0x06) return null; // laced blocks: not produced by browsers, refuse
      const packet = opusPacketMs(b.subarray(data + track.len + 3, end));
      if (packet === null) return null;
      ms += packet;
      if (clusterTc === null) return null; // a block with no cluster timecode cannot be placed
      const rel = (b[data + track.len] << 8) | b[data + track.len + 1];
      const start = clusterTc + (rel & 0x8000 ? rel - 0x10000 : rel);
      if (lastEnd !== null && start > lastEnd + MAX_GAP_MS) return null; // a jump forward on the timeline
      lastEnd = start + packet;
      timelineEnd = Math.max(timelineEnd, lastEnd);
    }
    pos = end;
  }
  if (pos !== b.length) return null;
  const oneTrack = tracks === 1 && opus && audio && [...blockTracks].every((t) => t === trackNumber);
  // The longer of what the packets hold and where the timeline ends.
  return oneTrack ? Math.max(ms, timelineEnd) / 1000 : null;
}

/** TimecodeScale from the Info element's children (default when absent), or null when Info cannot be read. */
function infoTimecodeScale(b: Uint8Array, start: number, end: number): number | null {
  let p = start, scale = DEFAULT_TIMECODE_SCALE, seen = false;
  while (p < end) { // every child is at least 2 bytes, so this loop is bounded by the element's size
    const id = vint(b, p, true);
    if (!id) return null;
    const size = vint(b, p + id.len, false);
    if (!size || size.unknown) return null;
    const data = p + id.len + size.len, stop = data + size.value;
    if (stop > end) return null;
    if (id.value === TIMECODE_SCALE) {
      if (seen || size.value < 1 || size.value > 8) return null;
      seen = true;
      scale = uint(b, data, stop);
    }
    p = stop;
  }
  return p === end ? scale : null;
}

// ---------- MP4 with AAC ----------
/** Every box we accept, by parent. Containers are walked; everything else is read or skipped. Anything else is refused. */
const MP4_CHILDREN: Record<string, Set<string>> = {
  "": new Set(["ftyp", "free", "skip", "mdat", "moov", "moof"]),
  moov: new Set(["mvhd", "trak", "mvex", "udta", "free"]),
  trak: new Set(["tkhd", "edts", "mdia", "udta"]),
  edts: new Set(["elst"]),
  mdia: new Set(["mdhd", "hdlr", "minf"]),
  minf: new Set(["smhd", "dinf", "stbl"]),
  stbl: new Set(["stsd", "stts", "stsc", "stsz", "stco", "co64", "sgpd", "sbgp", "stss"]),
  mvex: new Set(["trex", "mehd"]),
  moof: new Set(["mfhd", "traf"]),
  traf: new Set(["tfhd", "tfdt", "trun", "sgpd", "sbgp"]),
};
/** The most AAC frames 35 s can hold (1,024 samples at 96 kHz is the shortest frame). More is refused before any loop. */
export const MAX_AAC_FRAMES = Math.ceil((35 * 96_000) / 1024);
/** Every parse is a bounded walk: at most this many elements, boxes or blocks, then it gives up (refuses). */
const MAX_STEPS = 200_000;
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function u32(b: Uint8Array, p: number) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
const u64 = (b: Uint8Array, p: number) => u32(b, p) * 2 ** 32 + u32(b, p + 4);
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
  let traks = 0, frames = 0, aac = false, sound = false, bad = false;
  let ascRate: number | null = null, entryRate = 0, mvhdTs = 0, mdhdTs = 0, trexDur = 0;
  // Every length the file states, in its own timescale; the longest reading wins.
  const movieDurs: number[] = [], mediaDurs: number[] = [];
  let sttsSum = 0, trunSum = 0;

  const leaf = (type: string, data: number, stop: number) => {
    const v = b[data];
    if (type === "mvhd") { mvhdTs = u32(b, data + (v ? 20 : 12)); movieDurs.push(v ? u64(b, data + 24) : u32(b, data + 16)); }
    else if (type === "tkhd") movieDurs.push(v ? u64(b, data + 28) : u32(b, data + 20));
    else if (type === "mdhd") { mdhdTs = u32(b, data + (v ? 20 : 12)); mediaDurs.push(v ? u64(b, data + 24) : u32(b, data + 16)); }
    else if (type === "hdlr") sound = fourcc(b, data + 8) === "soun";
    else if (type === "mehd") movieDurs.push(v ? u64(b, data + 4) : u32(b, data + 4));
    else if (type === "elst") {
      const n = u32(b, data + 4);
      if (n > 1) bad = true; // more than one edit can repeat or skip media
      if (n === 1) {
        const e = data + 8;
        const seg = v ? u64(b, e) : u32(b, e);
        const mediaTime = v ? u32(b, e + 8) : u32(b, e + 4); // high word for v1; 0xffffffff means an empty edit
        const rate = v ? (b[e + 16] << 8) | b[e + 17] : (b[e + 8] << 8) | b[e + 9];
        if (mediaTime === 0xffffffff || rate !== 1) bad = true;
        movieDurs.push(seg);
      }
    } else if (type === "stsd") {
      if (u32(b, data + 4) !== 1) { bad = true; return; } // exactly one sample description
      const entry = data + 8, entryEnd = entry + u32(b, entry);
      // The sample entry and everything read inside it must end inside this stsd box (so inside the file).
      if (entry + 36 > stop || entryEnd < entry + 36 || entryEnd > stop) { bad = true; return; }
      if (fourcc(b, entry + 4) !== "mp4a" || ((b[entry + 16] << 8) | b[entry + 17]) !== 0) { bad = true; return; } // version 0 only
      aac = true;
      entryRate = u32(b, entry + 32) >>> 16;
      const esds = findBox(b, entry + 36, entryEnd, "esds");
      ascRate = esds ? aacRate(b, esds.data + 4, esds.end) : null;
    } else if (type === "stts") {
      const n = u32(b, data + 4);
      if (data + 8 + n * 8 > stop) { bad = true; return; }
      for (let i = 0; i < n; i++) sttsSum += u32(b, data + 8 + i * 8) * u32(b, data + 12 + i * 8);
    } else if (type === "stsz") { frames += u32(b, data + 8); if (frames > MAX_AAC_FRAMES) bad = true; }
    else if (type === "trex") trexDur = u32(b, data + 12);
    else if (type === "trun") {
      if (!tfhdSeen) { bad = true; return; } // each traf states its tfhd first
      const flags = u32(b, data) & 0xffffff, n = u32(b, data + 4);
      frames += n;
      if (n > MAX_AAC_FRAMES || frames > MAX_AAC_FRAMES) { bad = true; return; } // refused before any per-sample loop
      let q = data + 8 + (flags & 0x1 ? 4 : 0) + (flags & 0x4 ? 4 : 0);
      const per = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
      if (q + n * per > stop) { bad = true; return; }
      if (!(flags & 0x100)) trunSum += n * (tfhdDur || trexDur); // no per-sample durations: one multiplication
      else for (let i = 0; i < n; i++, q += per) trunSum += u32(b, q);
      // Where the fragment says it starts on the timeline (tfdt) plus what it holds: a gap before it still plays.
      if (tfdtBase !== null) timelineEnd = Math.max(timelineEnd, tfdtBase + (trunSum - trafStart));
    } else if (type === "tfdt") {
      if (tfdtBase !== null) { bad = true; return; } // one per traf
      tfdtBase = v ? u64(b, data + 4) : u32(b, data + 4);
      timelineEnd = Math.max(timelineEnd, tfdtBase);
    } else if (type === "tfhd") {
      const flags = u32(b, data) & 0xffffff;
      const q = data + 8 + (flags & 0x1 ? 8 : 0) + (flags & 0x2 ? 4 : 0);
      tfhdDur = flags & 0x8 ? u32(b, q) : 0;
      tfhdSeen = true;
    }
  };
  let tfhdDur = 0, tfhdSeen = false, steps = 0, tfdtBase: number | null = null, trafStart = 0, timelineEnd = 0;

  const walk = (parent: string, start: number, end: number): boolean => {
    let p = start;
    while (p < end) {
      if (p + 8 > end) return false; // trailing bytes
      let size = u32(b, p), head = 8;
      const type = fourcc(b, p + 4);
      if (!MP4_CHILDREN[parent]?.has(type)) return false; // a box we do not know, or in the wrong place
      if (size === 1) { if (p + 16 > end || u32(b, p + 8) !== 0) return false; size = u32(b, p + 12); head = 16; }
      else if (size === 0) { if (parent !== "" || type !== "mdat") return false; size = end - p; }
      if (size < head || p + size > end) return false;
      const data = p + head, stop = p + size;
      if (++steps > MAX_STEPS) return false;
      if (type === "trak") traks++;
      if (type === "traf") { tfhdSeen = false; tfhdDur = 0; tfdtBase = null; trafStart = trunSum; }
      if (MP4_CHILDREN[type]) { if (!walk(type, data, stop)) return false; }
      else { leaf(type, data, stop); if (bad) return false; }
      p = stop;
    }
    return p === end;
  };
  if (!walk("", 0, b.length) || bad) return null;
  // Where the sample entry and the codec config disagree, the lower rate (the longer playback) wins.
  const rate = ascRate && entryRate ? Math.min(ascRate, entryRate) : ascRate;
  if (traks !== 1 || !aac || !sound || !rate || !mdhdTs) return null;
  const readings = [(frames * 1024) / rate, sttsSum / mdhdTs, trunSum / mdhdTs, timelineEnd / mdhdTs, ...mediaDurs.map((d) => d / mdhdTs)];
  if (mvhdTs) readings.push(...movieDurs.map((d) => d / mvhdTs));
  return Math.max(...readings);
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
