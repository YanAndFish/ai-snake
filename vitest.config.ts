import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/sim/**",
        "src/ai/**",
        "src/engine/loop.ts",
        "src/engine/loop.hot.ts",
        "src/engine/rng.ts",
        "src/engine/audio.ts",
        "src/app/session.ts",
        "src/app/keyStore.ts",
        "src/app/testApi.ts",
        "src/app/frame.hot.ts",
      ],
      exclude: ["test/**"],
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
