import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The pgbouncer contract, pinned.
 *
 * DATABASE_URL points at pgbouncer in POOL_MODE=transaction, where a server
 * backend moves between clients between statements. A named prepared statement
 * created on one backend and executed on another raises "prepared statement
 * ... does not exist" - intermittently, under load, in production only, which
 * is precisely the class of regression a test has to hold in place because
 * nothing else will catch it before a deploy.
 *
 * postgres() is mocked here rather than connected to: the assertion is about
 * the options object, and the real client opens sockets lazily but still wants
 * a reachable host for anything beyond construction.
 */

const postgresMock = vi.hoisted(() =>
  vi.fn(() => {
    const sql = () => undefined
    return Object.assign(sql, { options: { parsers: {}, serializers: {} } })
  }),
)

vi.mock('postgres', () => ({ default: postgresMock }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn(() => ({ __db: true })) }))

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  postgresMock.mockClear()
})

const URL_POOLED = 'postgresql://u:p@pgbouncer:5432/kerjacus?sslmode=disable'

describe('postgres.js client options', () => {
  it('disables prepared statements so transaction pooling cannot lose them', async () => {
    vi.stubEnv('DATABASE_URL', URL_POOLED)
    const { getDb } = await import('./client')

    getDb()

    expect(postgresMock).toHaveBeenCalledTimes(1)
    const [url, options] = postgresMock.mock.calls[0] as unknown as [
      string,
      { prepare: boolean; max: number },
    ]
    expect(url).toBe(URL_POOLED)
    expect(options.prepare).toBe(false)
  })

  it('keeps the per-process connection ceiling at 10', async () => {
    vi.stubEnv('DATABASE_URL', URL_POOLED)
    const { getDb } = await import('./client')

    getDb()

    const [, options] = postgresMock.mock.calls[0] as unknown as [string, { max: number }]
    expect(options.max).toBe(10)
  })

  it('applies the same options to an explicitly passed URL', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { getDb } = await import('./client')

    getDb('postgresql://u:p@postgres:5432/kerjacus')

    const [, options] = postgresMock.mock.calls[0] as unknown as [string, { prepare: boolean }]
    expect(options.prepare).toBe(false)
  })
})
