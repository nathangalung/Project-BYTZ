import { defineConfig } from 'vitest/config'

/**
 * One coverage definition for every workspace.
 *
 * Coverage ran on defaults before this. The root vitest.config.ts looked like
 * the policy, carrying 95 and 90 thresholds, but every script goes through
 * turbo and turbo runs vitest inside each workspace, so that file was never
 * loaded and those thresholds never ran. Two workspaces had a `test:coverage`
 * script that did not pass `--coverage` at all, and CI uploaded the empty
 * result as an artifact.
 *
 * Pass `include` as an array with one entry per extension. The brace form
 * `src/**\/*.{ts,tsx}` matches almost nothing through vitest's glob and reports
 * a handful of statements beside a healthy percentage, which is the kind of
 * failure that reads as a pass.
 */

export type CoverageTargets = {
  readonly statements: number
  readonly branches: number
  readonly functions: number
  readonly lines: number
}

/** Files carrying no branch worth executing. */
const ALWAYS_EXCLUDED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.config.ts',
  '**/*.d.ts',
  // Rewritten by the TanStack Router plugin on every build.
  '**/routeTree.gen.ts',
]

export type CoverageOptions = {
  /** Globs to instrument, one entry per extension. */
  readonly include: string[]
  readonly exclude?: string[]
  readonly thresholds: CoverageTargets
}

/**
 * Coverage block for apps that already own a vite.config.ts.
 *
 * web and admin load plugins and the `@` alias from theirs, so a separate
 * vitest.config.ts would shadow it and break resolution. They merge this in.
 */
export function coverageConfig(options: CoverageOptions) {
  return {
    provider: 'v8' as const,
    // Naming include is what instruments files no test imports. Vitest 4
    // dropped the separate `all` flag; an untested module now reads as zero
    // rather than being absent from the report.
    include: options.include,
    exclude: [...ALWAYS_EXCLUDED, ...(options.exclude ?? [])],
    reporter: ['text-summary', 'json-summary', 'lcov'] as string[],
    thresholds: options.thresholds,
  }
}

type Options = CoverageOptions & {
  readonly environment?: 'node' | 'jsdom'
  readonly setupFiles?: string[]
}

/** Full config for workspaces with no vite.config.ts of their own. */
export function workspaceConfig(options: Options) {
  return defineConfig({
    test: {
      environment: options.environment ?? 'node',
      setupFiles: options.setupFiles,
      coverage: coverageConfig(options),
    },
  })
}
