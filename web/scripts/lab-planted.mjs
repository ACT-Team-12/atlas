// Planted-mistake test for "Explain my lab results" (no AI, no server). Usage: node scripts/lab-planted.mjs
// Runs src/lib/labPlanted.test.ts with WRITE_LAB_PLANTED=1, which writes src/data/eval/lab-planted.json from a fresh run.
// The same test fails later if the code changes and the file is not regenerated.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const r = spawnSync(process.execPath, [vitest, "run", "src/lib/labPlanted.test.ts"], {
  cwd: web,
  stdio: "inherit",
  env: { ...process.env, WRITE_LAB_PLANTED: "1" },
});
process.exit(r.status ?? 1);
