// Non-gating benchmark: how long the quote checker takes at the request limits (20,000-character source,
// 600-character quotes, 40 items) on adversarial input. The tests assert step counts, not time; this prints time.
// Usage: node --experimental-strip-types --no-warnings scripts/bench-checker.mjs
import { findSpan, verifyItems } from "../src/lib/verify.ts";

const source = "İ".repeat(20000) + " ̇" + "İ".repeat(299);
const quotes = Array.from({ length: 40 }, (_, i) => (i % 2 ? "̇i".repeat(300) : "̇i".repeat(299) + "̇"));
const items = quotes.map((source_quote) => ({ kind: "medication", title: "t", plain_language: "p", why: "", when: "", source_quote, needs_clarification: false, question_for_clinic: "" }));

const time = (f) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
for (let run = 0; run < 3; run++) {
  const batch = time(() => verifyItems(source, items));
  const single = time(() => quotes.forEach((q) => findSpan(source, q)));
  console.log(`40 items: verifyItems ${batch.toFixed(1)} ms (mapped once), 40 x findSpan ${single.toFixed(1)} ms (mapped per call)`);
}
