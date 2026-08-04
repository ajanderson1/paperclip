import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  test: {
    environment: "node",
    // JSDOM-heavy suites allocate a full DOM per worker. Cap worker fan-out so
    // rendering assertions retain CPU time on developer laptops and CI.
    maxWorkers: 4,
    minWorkers: 1,
    pool: "forks",
    setupFiles: ["./vitest.setup.ts"],
  },
});
