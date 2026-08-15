import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  /**
   * The 28 integration files already serialise: each takes
   * pg_advisory_lock(20260813) in beforeAll and holds it until its connection
   * closes in afterAll. Running them in parallel therefore buys nothing and
   * puts 27 files in a lock queue, each burning its own 120s beforeAll
   * deadline while it waits. Under load the ones at the back time out, and
   * which ones lose is scheduling-dependent, so it reads as flake.
   *
   * Measured: parallel 2m58s with timeouts and 13 tests skipped, sequential
   * 2m38s and deterministic. Serialising is both faster and honest here, and
   * it gets strictly better relative to parallel with every file added.
   */
  fileParallelism: false,
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
  thresholds: { statements: 98, branches: 93, functions: 99, lines: 98 },
})
