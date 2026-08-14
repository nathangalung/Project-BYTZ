import { describe, expect, it, vi } from 'vitest'

/**
 * The gate that decides which requests need a session, which may have one, and
 * which need none at all.
 *
 * This middleware is the outermost access-control decision in the service and
 * it is made by string matching on path and method, so every branch is one
 * typo away from opening a route. The dangerous direction is specific:
 * `return next()` on the public list means no session is resolved AND none is
 * required, and the comment in the source records that the project-detail
 * branch once did exactly that and "made every project world-readable" - the
 * handler's visibility gate cannot help if it is never told who is asking.
 *
 * Four outcomes are asserted for four classes of request. What is checked is
 * only that the gate did or did not demand a session, which is its whole job;
 * what each handler then does with the caller is asserted in the route suites.
 *
 * The background workers are mocked out for the same reason openapi-parity
 * does it: importing this module otherwise starts an outbox loop, a scheduler
 * and two NATS consumers. The middleware itself is entirely real.
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

type ErrorBody = { error?: { code?: string } }

/** Did the session gate refuse this request before any handler ran? */
async function refusedByGate(path: string, init?: RequestInit): Promise<boolean> {
  const res = await app.request(path, init)
  if (res.status !== 401) return false
  const body = (await res.json().catch(() => ({}))) as ErrorBody
  return body.error?.code === 'AUTH_UNAUTHORIZED'
}

describe('session gate', () => {
  /**
   * The landing page reads these with no account. The same list feeds the
   * OpenAPI document, so the contract cannot advertise auth the gate does not
   * require.
   */
  it.each([
    '/api/v1/projects/stats',
    '/api/v1/projects/public',
    '/api/v1/projects/available',
    '/api/v1/reviews/public',
    '/api/v1/projects/openapi.json',
  ])('lets an anonymous caller through to %s', async (path) => {
    expect(await refusedByGate(path)).toBe(false)
  })

  /**
   * The public list is matched on path AND method. A POST to a path that is
   * public for GET is a different route and must still need a session.
   */
  it('does not extend a public GET to other methods on the same path', async () => {
    expect(await refusedByGate('/api/v1/projects/public', { method: 'POST' })).toBe(true)
  })

  /**
   * The list is compared with `===`, not a prefix test, so a longer path that
   * merely starts with a public one is private. Checked on /reviews rather
   * than /projects: under /projects any single trailing segment is the
   * project-detail shape and is anonymously readable by design, so
   * /projects/publicity is routed as a project id rather than being a hole.
   */
  it('does not treat a path merely starting with a public one as public', async () => {
    expect(await refusedByGate('/api/v1/reviews/publicity')).toBe(true)
  })

  /**
   * Project detail is readable anonymously but is NOT on the public list, and
   * the difference is the point: the gate resolves a session when a cookie is
   * present so the handler can tell owner from stranger, and requires none
   * when it is absent. Returning next() outright here is the regression the
   * source comment records.
   */
  it('admits an anonymous reader to a project detail page', async () => {
    expect(await refusedByGate('/api/v1/projects/01a00000-0000-7000-8000-000000000001')).toBe(false)
  })

  /** Only the bare detail path. Sub-resources of a project are private. */
  it.each([
    '/api/v1/projects/01a00000-0000-7000-8000-000000000001/brd',
    '/api/v1/projects/01a00000-0000-7000-8000-000000000001/milestones',
    '/api/v1/projects/01a00000-0000-7000-8000-000000000001/status-logs',
  ])('still requires a session for %s', async (path) => {
    expect(await refusedByGate(path)).toBe(true)
  })

  /** Writing a project is not reading one, even at the same path shape. */
  it('requires a session to POST to the projects collection', async () => {
    expect(await refusedByGate('/api/v1/projects', { method: 'POST' })).toBe(true)
  })

  it('requires a session to list projects', async () => {
    expect(await refusedByGate('/api/v1/projects')).toBe(true)
  })

  it.each([
    '/api/v1/milestones',
    '/api/v1/work-packages',
    '/api/v1/talent-profiles',
    '/api/v1/invoices',
    '/api/v1/time-logs',
  ])('requires a session for %s', async (path) => {
    expect(await refusedByGate(path)).toBe(true)
  })

  /**
   * The inter-service door. The gate lets the request past the session check
   * only when the header is present; the handler is what verifies the secret,
   * so presence alone must not be enough to reach a route that is not on the
   * inter-service list.
   */
  it('lets an X-Service-Auth caller past the session gate on a listed route', async () => {
    const refused = await refusedByGate('/api/v1/matching/recommend', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json', 'X-Service-Auth': 'anything' },
    })

    expect(refused).toBe(false)
  })

  it('does not let the header open a route that is not on the inter-service list', async () => {
    const refused = await refusedByGate('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json', 'X-Service-Auth': 'anything' },
    })

    expect(refused).toBe(true)
  })

  it('still requires a session on a listed route when the header is absent', async () => {
    const refused = await refusedByGate('/api/v1/matching/recommend', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(refused).toBe(true)
  })

  /** /health sits outside the /api/v1/ prefix the gate is mounted on. */
  it('does not gate the liveness probe', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ service: 'project-service' })
  })
})
