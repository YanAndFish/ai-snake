import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/sim/**", "src/ai/**", "src/engine/**", "src/app/testApi.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 80,
      },
    },
  },
});
