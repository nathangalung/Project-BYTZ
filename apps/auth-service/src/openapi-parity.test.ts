import { describe, expect, it, vi } from 'vitest'

/**
 * The OpenAPI spec is a hand-written JSON literal, so nothing forces it to
 * track the routes. It had already drifted: POST /api/v1/auth/update-user was
 * mounted and undocumented. This diffs the two sets in both directions.
 */

// index.ts validates env at import and boots tracing.
process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/x'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.NATS_URL = 'nats://localhost:4222'
process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
process.env.BETTER_AUTH_URL = 'http://localhost:3001'

vi.mock('./otel', () => ({}))
vi.mock('./lib/auth', () => ({ auth: { handler: async () => new Response('{}') } }))

const { app, openApiSpec } = await import('./index')

/*
 * Documented but with no route of their own: Better Auth serves them through
 * authRoute.all('/*'). They stay in the spec because the web client calls
 * them, but they are Better Auth's contract, not ours. A wildcard mount is
 * indistinguishable from middleware by {method, path} - app.use registers as
 * ALL too - so the catch-all cannot be matched, only named here.
 */
const SERVED_BY_BETTER_AUTH_CATCHALL = [
  'POST /api/v1/auth/sign-out',
  'GET /api/v1/auth/get-session',
  'POST /api/v1/auth/sign-in/social',
]

// The docs endpoints serve the spec; describing them inside it is circular.
const UNDOCUMENTED_BY_DESIGN = ['GET /api/v1/auth/docs', 'GET /api/v1/auth/openapi.json']

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']

describe('OpenAPI spec matches the mounted routes', () => {
  /*
   * Wildcards are middleware and the Better Auth catch-all, never concrete
   * routes. Method ALL is dropped for the same reason: app.use registers that
   * way, so a middleware pinned to one exact path (the strict rate limiter on
   * each credential endpoint) would otherwise read as an undocumented route.
   * Every real route here is registered with a concrete verb.
   */
  const mounted = new Set(
    app.routes
      .filter((r) => !r.path.endsWith('*') && r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path}`)
      .filter((r) => !UNDOCUMENTED_BY_DESIGN.includes(r)),
  )

  const documented = new Set(
    Object.entries(openApiSpec.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((m) => HTTP_METHODS.includes(m))
        .map((m) => `${m.toUpperCase()} ${path}`),
    ),
  )

  it('documents every mounted route', () => {
    expect([...mounted].filter((r) => !documented.has(r)).sort()).toEqual([])
  })

  it('mounts every documented route', () => {
    const missing = [...documented].filter(
      (r) => !mounted.has(r) && !SERVED_BY_BETTER_AUTH_CATCHALL.includes(r),
    )
    expect(missing.sort()).toEqual([])
  })

  /**
   * app.route() flattens a sub-app's table into the parent, wildcards
   * included. A `use('*')` inside a sub-app mounted on the shared
   * /api/v1/auth prefix therefore guards the whole prefix: sign-in, sign-up,
   * forget-password and the Google callback would all answer 401 before their
   * handler ran. Every route file that drives its sub-app directly - which is
   * all of them - passes throughout that failure.
   */
  it('leaves the catch-all as the only wildcard on the auth prefix', () => {
    const wildcards = app.routes.filter((r) => r.path === '/api/v1/auth/*')

    expect(wildcards.map((r) => r.method)).toEqual(['ALL'])
  })

  it('still answers an unauthenticated sign-in from its own handler', async () => {
    const res = await app.request('/api/v1/auth/sign-in/email-or-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    // The route's own validation, not a session guard in front of it.
    expect(res.status).toBe(400)
  })

  // The spec is read from the module; this proves it is still served too.
  it('serves the spec as JSON', async () => {
    const res = await app.request('/api/v1/auth/openapi.json')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ openapi: '3.1.0' })
  })
})
