// Loader for atlas_verify.wasm (the Rust quote checker). Works in Node and in the browser; no dependencies.
//
//   import { load } from "./atlas_verify.mjs";
//   const atlas = await load(bytes);            // Node: fs.readFileSync(".../atlas_verify.wasm")
//   const atlas = await load(fetch(wasmUrl));   // browser
//   atlas.findSpan(source, quote)               // same contract as web/src/lib/verify.ts findSpan
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
  const out = (len) => {
    if (len < 0) throw new Error("atlas_verify: input was not valid UTF-8");
    return dec.decode(new Uint8Array(x.memory.buffer, x.atlas_out_ptr(), len));
  };
  const withString = (s, fn) => {
    const [p, l] = put(s);
    try {
      return fn(p, l);
    } finally {
      x.atlas_free(p, l);
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
          // NaN marks the TS checker's own undefined / NaN offsets (see Span in src/lib.rs).
          const start = x.atlas_span_start();
          return { start: Number.isNaN(start) ? undefined : start, end: x.atlas_span_end() };
        }),
      );
    },
    normalize(s) {
      return withString(s, (p, l) => out(x.atlas_normalize(p, l)));
    },
    /** The planted fakes for one real instruction: [{ kind, text }]. */
    fakesFor(real) {
      return JSON.parse(withString(real, (p, l) => out(x.atlas_fakes_for(p, l))));
    },
  };
}
