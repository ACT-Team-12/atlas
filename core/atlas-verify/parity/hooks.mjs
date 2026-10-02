// Node module hooks so the parity script can import the web app's TypeScript as-is (no bundler, no web install):
// resolves the "@/" alias to web/src, adds the missing ".ts" extension, and loads ".json" imports as modules.
// Type annotations are stripped by Node's own --experimental-strip-types.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB_SRC = new URL("../../../web/src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2), WEB_SRC).href;
  if (spec.startsWith("file:") || spec.startsWith(".")) {
    const base = context.parentURL ?? import.meta.url;
    const url = new URL(spec, base);
    const path = fileURLToPath(url);
    if (!existsSync(path) && existsSync(`${path}.ts`)) spec = pathToFileURL(`${path}.ts`).href;
    else spec = url.href;
  }
  return nextResolve(spec, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const text = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
