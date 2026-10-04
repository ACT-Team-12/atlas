import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

// On a small machine (8 GB, 8 cores) the default worker count runs every CPU-heavy file at once and some tests cross
// their timeout. Locally, use about half the cores (at least 1). In CI, leave vitest's own default unchanged.
const localWorkers = Math.max(1, Math.floor(availableParallelism() / 2));

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    ...(process.env.CI ? {} : { maxWorkers: localWorkers }),
  },
});
