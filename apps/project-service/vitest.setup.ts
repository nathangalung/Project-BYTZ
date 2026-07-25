process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.NATS_URL ??= 'nats://localhost:4222'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001'
// Required by projectEnvSchema (inter-service auth). CI does not export it and
// modules that import env.ts (session middleware, outbox worker) validate at
// import time, so its absence throws before any test body runs.
//
// Assigned unconditionally, unlike the vars above: bun auto-loads the repo-root
// .env, so `??=` let a developer's real secret leak into the test process and
// payment-client.test.ts failed under `bun run test` while passing under the
// node vitest binary. Tests assert this literal, so it must be deterministic.
process.env.SERVICE_AUTH_SECRET = 'test-service-auth-secret'
