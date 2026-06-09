import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // entry point — covered by integration tests
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
      reporter: ["text", "lcov"],
    },
  },
});
