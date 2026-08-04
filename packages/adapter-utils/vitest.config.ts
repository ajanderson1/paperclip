import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // These suites create real local child-process and sandbox bridges. Run
    // them in one fork to avoid starving their short-lived IPC handshakes.
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    testTimeout: 15_000,
    minWorkers: 1,
    pool: "forks",
    sequence: {
      concurrent: false,
      hooks: "list",
    },
  },
});
