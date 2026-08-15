import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  include: ['src/**/*.ts'],
  exclude: [
    // 6280 lines of fixture rows with no branches, and it opens with a
    // TRUNCATE. Importing it to measure it is not worth the risk.
    'src/seed.ts',
    // Drizzle table definitions are declarations, not logic. Importing a table
    // to raise a percentage asserts nothing about it; what actually verifies
    // this schema is the migrations that build it and the integration suites
    // that read and write through it.
    'src/schema/**',
  ],
  thresholds: { statements: 96, branches: 92, functions: 91, lines: 100 },
})
