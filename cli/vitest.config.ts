import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // CLI end-to-end suites each start subprocesses and embedded services;
    // cap worker fan-out so those child processes retain CPU during release runs.
    maxWorkers: 4,
    minWorkers: 1,
    pool: "forks",
  },
});
