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
      },
      include: [
        "packages/shared/src/**/*.ts",
        "packages/nats-events/src/**/*.ts",
        "apps/auth-service/src/lib/**/*.ts",
        "apps/auth-service/src/routes/**/*.ts",
        "apps/auth-service/src/middleware/**/*.ts",
        // Whole tree, not a list of directory names. Listing lib, services and
        // middleware left routes, repositories, activities and workflows
        // unmeasured, which is most of the service and includes the Temporal
        // orchestration that owns escrow release. It also made the directory
        // names load-bearing: moving a file out of lib/ silently dropped it
        // from coverage without failing anything.
        "apps/project-service/src/**/*.ts",
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
