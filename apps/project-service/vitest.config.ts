import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  // Pins SERVICE_AUTH_SECRET and the connection strings. Bun auto-loads the
  // repo-root .env, so without this a developer's real secret reaches the test
  // process and payment-client.test.ts asserts against it.
  setupFiles: ['./vitest.setup.ts'],
  include: ['src/**/*.ts'],
  exclude: [
    // Temporal workflow bundles run in the Temporal sandbox, not vitest.
    'src/workflows/**',
  ],
  // Raised as the integration harness lands. A number the suite already clears
  // is not a gate.
  thresholds: { statements: 37, branches: 35, functions: 42, lines: 37 },
})
