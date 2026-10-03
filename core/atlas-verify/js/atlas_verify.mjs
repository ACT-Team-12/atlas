// Loader for atlas_verify.wasm (the Rust quote checker). Works in Node and in the browser; no dependencies.
//
//   import { load } from "./atlas_verify.mjs";
//   const atlas = await load(bytes);            // Node: fs.readFileSync(".../atlas_verify.wasm")
//   const atlas = await load(fetch(wasmUrl));   // browser
//   atlas.findSpan(source, quote)               // same contract as web/src/lib/verify.ts findSpan
//   atlas.findSpans(source, quotes)             // findSpan for each quote, mapping the source once
//
// Strings cross the boundary as UTF-8. A JS string holding a lone surrogate is encoded as U+FFFD by TextEncoder, so
// for that one input class the result can differ from the TS checker (see the crate README).

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function load(source) {
  const resolved = await source;
  let instance;
  if (typeof Response !== "undefined" && resolved instanceof Response) {
    ({ instance } = await WebAssembly.instantiateStreaming(resolved, {}));
  } else {
    ({ instance } = await WebAssembly.instantiate(resolved, {}));
  }
  return wrap(instance.exports);
}

function wrap(x) {
  const put = (s) => {
    const bytes = enc.encode(s);
    const ptr = x.atlas_alloc(bytes.length);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  // The paper and quotes must not stay readable in linear memory (the instance outlives the call): zero what we
  // wrote before freeing it (Rust also zeroes every block it frees), and clear the output buffer once read.
  const wipeFree = (p, l) => {
    new Uint8Array(x.memory.buffer, p, l).fill(0);
    x.atlas_free(p, l);
  };
  const out = (len) => {
    if (len < 0) throw new Error("atlas_verify: input was not valid UTF-8");
    const text = dec.decode(new Uint8Array(x.memory.buffer, x.atlas_out_ptr(), len));
    x.atlas_clear_out();
    return text;
  };
  // Quotes cross as frames: a little-endian u32 byte length, then the UTF-8 bytes.
  const putFrames = (strings) => {
    const parts = strings.map((s) => enc.encode(s));
    const total = parts.reduce((n, b) => n + 4 + b.length, 0);
    const ptr = x.atlas_alloc(total);
    const view = new DataView(x.memory.buffer, ptr, total);
    const bytes = new Uint8Array(x.memory.buffer, ptr, total);
    let at = 0;
    for (const b of parts) {
      view.setUint32(at, b.length, true);
      bytes.set(b, at + 4);
      at += 4 + b.length;
    }
    return [ptr, total];
  };
  const withString = (s, fn) => {
    const [p, l] = put(s);
    try {
      return fn(p, l);
    } finally {
      wipeFree(p, l);
    }
  };

  return {
    /** `{ start, end }` in UTF-16 units (JS string indices), or null when the quote is not in the source. */
    findSpan(source, quote) {
      return withString(source, (sp, sl) =>
        withString(quote, (qp, ql) => {
          const r = x.atlas_find_span(sp, sl, qp, ql);
          if (r < 0) throw new Error("atlas_verify: input was not valid UTF-8");
          if (r === 0) return null;
          return { start: x.atlas_span_start(), end: x.atlas_span_end() };
        }),
      );
    },
    /** findSpan for every quote, in order, with the source mapped once. */
    findSpans(source, quotes) {
      return withString(source, (sp, sl) => {
        const [qp, ql] = putFrames(quotes);
        try {
          return JSON.parse(out(x.atlas_find_spans(sp, sl, qp, ql))).map((r) => (r === null ? null : { start: r[0], end: r[1] }));
        } finally {
          wipeFree(qp, ql);
        }
      });
    },
    normalize(s) {
      return withString(s, (p, l) => out(x.atlas_normalize(p, l)));
    },
    /** The planted fakes for one real instruction: [{ kind, text }]. */
    fakesFor(real) {
      return JSON.parse(withString(real, (p, l) => out(x.atlas_fakes_for(p, l))));
    },
    /**
     * The Unicode version the Rust build lower-cases with, as "major.minor" (the form of process.versions.unicode).
     * Case mapping only matches the JS engine's toLowerCase when the two versions are equal.
     */
    unicodeVersion() {
      const v = x.atlas_unicode_version();
      return `${Math.floor(v / 1_000_000)}.${Math.floor(v / 1_000) % 1_000}`;
    },
  };
}
