import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts", // entry point — covered by integration tests
        // Thin bin shims: no logic beyond calling runInstaller + exit mapping.
        // The tested logic lives in src/installer.ts.
        "src/install.ts",
        "src/uninstall.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
      reporter: ["text", "lcov"],
    },
  },
});
