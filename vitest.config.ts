import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        "packages/shared/src/**": {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        "packages/nats-events/src/**": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
        "packages/testing/src/**": {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
      },
      include: [
        "packages/shared/src/**/*.ts",
        "packages/nats-events/src/**/*.ts",
        "packages/testing/src/**/*.ts",
        "apps/project-service/src/lib/**/*.ts",
        "apps/project-service/src/services/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/index.ts",
        "**/*.d.ts",
        "**/types.ts",
      ],
    },
  },
});
