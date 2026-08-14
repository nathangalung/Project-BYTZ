import { describe, expect, it, vi } from 'vitest'

/**
 * The served document derives its paths from app.routes, so it cannot drift
 * from the route table the way a hand-written literal does. What can still
 * break is the derivation: the filters that drop middleware, and the
 * :id -> {id} rewrite.
 *
 * So this re-derives the expected set independently instead of importing the
 * production helper. A test that calls the code under test to compute its own
 * expectation proves only that the function is deterministic.
 */

vi.mock('./otel', () => ({}))
vi.mock('./services/outbox-worker', () => ({
  startOutboxProcessor: async () => {},
  stopOutboxProcessor: async () => {},
}))
vi.mock('./services/scheduled-jobs', () => ({
  startScheduledJobs: () => {},
  stopScheduledJobs: () => {},
}))
vi.mock('./services/invoice-consumer', () => ({
  startInvoiceConsumer: async () => {},
  stopInvoiceConsumer: async () => {},
}))
vi.mock('./services/settlement-consumer', () => ({
  startSettlementConsumer: async () => {},
  stopSettlementConsumer: async () => {},
}))

const { app } = await import('./index')

type SpecDocument = {
  openapi: string
  info: { title: string; version: string; description?: string }
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> }
  paths: Record<string, Record<string, unknown>>
}

const specResponse = await app.request('/api/v1/projects/openapi.json')
const spec = (await specResponse.json()) as SpecDocument

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

/** These two deliver the document; listing them inside it is circular. */
const UNDOCUMENTED_BY_DESIGN = ['GET /api/v1/projects/docs', 'GET /api/v1/projects/openapi.json']

/*
 * Hono registers app.use() into the same table as handlers, as method ALL.
 * Seven of ours carry concrete paths - the strict rate-limit tier names
 * /api/v1/projects/:id/generate-prd and six siblings outright - so filtering
 * middleware by a trailing '*' alone, which is all auth-service needs, would
 * let those seven through and document 'all' as an HTTP operation here.
 *
 * The cost of keying on ALL is that a genuine .all() handler is invisible to
 * both sides of this diff. project-service has none today; if one is added it
 * must be documented by hand, because {method, path} cannot tell it apart
 * from middleware.
 */
const mounted = new Set(
  app.routes
    .filter((r) => r.method !== 'ALL')
    .map((r) => `${r.method} ${r.path.replace(/:([^/]+)/g, '{$1}')}`)
    .filter((r) => !UNDOCUMENTED_BY_DESIGN.includes(r)),
)

const documented = new Set(
  Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => HTTP_METHODS.includes(method))
      .map((method) => `${method.toUpperCase()} ${path}`),
  ),
)

describe('OpenAPI document matches the mounted routes', () => {
  it('serves the document', () => {
    expect(specResponse.status).toBe(200)
    expect(spec.openapi).toBe('3.1.0')
  })

  it('documents every mounted route', () => {
    expect([...mounted].filter((r) => !documented.has(r)).sort()).toEqual([])
  })

  it('mounts every documented route', () => {
    expect([...documented].filter((r) => !mounted.has(r)).sort()).toEqual([])
  })

  it('documents more than a handful of routes', () => {
    // Both sides filter, so both could filter to nothing and still agree.
    expect(documented.size).toBeGreaterThan(80)
  })

  it('emits only real HTTP operations', () => {
    // Middleware leaking through would show up here as an 'all' operation.
    const stray = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => !HTTP_METHODS.includes(key))
        .map((key) => `${path} -> ${key}`),
    )
    expect(stray.sort()).toEqual([])
  })

  it('emits OpenAPI path templates, not Hono patterns', () => {
    const malformed = Object.keys(spec.paths).filter(
      (path) => path.includes(':') || path.includes('*'),
    )
    expect(malformed.sort()).toEqual([])
  })

  it('declares a path parameter for every template placeholder', () => {
    const missing: string[] = []
    for (const [path, item] of Object.entries(spec.paths)) {
      const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
      for (const [method, operation] of Object.entries(item)) {
        if (!HTTP_METHODS.includes(method)) continue
        const declared = ((operation as { parameters?: { name: string }[] }).parameters ?? []).map(
          (p) => p.name,
        )
        for (const placeholder of placeholders) {
          if (!declared.includes(placeholder)) missing.push(`${method.toUpperCase()} ${path}`)
        }
      }
    }
    expect(missing.sort()).toEqual([])
  })

  it('keeps the security scheme and the error envelope', () => {
    expect(spec.components.securitySchemes).toHaveProperty('sessionCookie')
    expect(spec.components.schemas).toHaveProperty('Error')
  })

  it('says what it does not cover', () => {
    expect(spec.info.description).toMatch(/derived/i)
  })

  it('leaves the public browse endpoints unauthenticated', () => {
    // index.ts routes these past sessionMiddleware; the document must agree,
    // or it tells an anonymous caller to log in for a public listing.
    for (const path of ['/api/v1/projects/public', '/api/v1/projects/stats']) {
      expect(spec.paths[path]?.get).toMatchObject({ security: [] })
    }
  })

  it('leaves the health probes unauthenticated', () => {
    // The session gate is mounted on /api/v1/* and never sees /health. These
    // two come from the default branch rather than from a list index.ts hands
    // over, so they are the only check on it - and they were documented as
    // needing a cookie that Docker and K8s do not send.
    for (const path of ['/health', '/health/ready']) {
      expect(spec.paths[path]?.get).toMatchObject({ security: [] })
    }
  })

  it('marks the optionally-authenticated project detail as such', () => {
    // Guards the one hand-written key with no other feedback: rename the Hono
    // param and this entry silently stops matching, at which point the public
    // project page starts claiming it needs a login.
    expect(spec.paths['/api/v1/projects/{id}']?.get).toMatchObject({
      security: [{ sessionCookie: [] }, {}],
    })
    // Same path, different operation: PATCH really does require the session.
    expect(spec.paths['/api/v1/projects/{id}']?.patch).toMatchObject({
      security: [{ sessionCookie: [] }],
    })
  })

  it('records the inter-service auth alternative on the matching call', () => {
    expect(spec.paths['/api/v1/matching/recommend']?.post).toMatchObject({
      security: [{ sessionCookie: [] }, { serviceAuth: [] }],
    })
  })
})
