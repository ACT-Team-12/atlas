// Loads pkg/atlas_verify.wasm in Node and checks one real quote and one planted fake.
//   node js/demo.mjs
import { readFileSync } from "node:fs";
import { load } from "../pkg/atlas_verify.mjs";

const atlas = await load(readFileSync(new URL("../pkg/atlas_verify.wasm", import.meta.url)));
const paper = "Medication changes\nSTART taking:\n- metformin 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.";
const real = "take 1 tablet by mouth 2 times a day";
const fake = atlas.fakesFor(real).find((f) => f.kind === "changed number").text;
const span = atlas.findSpan(paper, real);
console.log(JSON.stringify({
  real: { quote: real, span, text: paper.slice(span.start, span.end) },
  fake: { quote: fake, span: atlas.findSpan(paper, fake) },
}));
if (!span || atlas.findSpan(paper, fake) !== null) process.exit(1);
