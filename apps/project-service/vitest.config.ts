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
  // is not a gate. Measured 45.93/42.87/57.99/45.40 once the repository suites
  // ran against a real Postgres; floored to the whole number below each.
  //
  // These only hold if TEST_DATABASE_URL is set. Without it every
  // *.integration.test.ts skips and the suite lands back near 37, so the CI
  // test-unit job provisioning that service is what keeps this gate honest.
  thresholds: { statements: 45, branches: 42, functions: 57, lines: 45 },
})
