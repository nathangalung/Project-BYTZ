process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.NATS_URL ??= 'nats://localhost:4222'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001'
// Required by projectEnvSchema (inter-service auth). CI does not export it and
// modules that import env.ts (session middleware, outbox worker) validate at
// import time, so its absence throws before any test body runs.
process.env.SERVICE_AUTH_SECRET ??= 'test-service-auth-secret'
