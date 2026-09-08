import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasTestDatabase, testDatabaseUrl, truncateAll } from './testing'

/**
 * The guard on the harness that truncates every table.
 *
 * connectTestDatabase refuses any database whose name does not end in `_test`,
 * checked before the first statement. That rail matters more than the rest of
 * this file: the dev database usually sits on the same server, packages/db/src
 * /seed.ts opens with TRUNCATE ... CASCADE, and a harness pointed one character
 * wrong would take somebody's local data with it.
 *
 * Connecting is covered by the suites that use it. What is covered here is the
 * refusal, which must hold without a server present at all.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('testDatabaseUrl', () => {
  it('reads TEST_DATABASE_URL', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://u:p@localhost:5432/x_test')

    expect(testDatabaseUrl()).toBe('postgresql://u:p@localhost:5432/x_test')
  })

  /** Unset and blank both mean skip, not connect to something surprising. */
  it('treats blank and whitespace as unset', () => {
    vi.stubEnv('TEST_DATABASE_URL', '')
    expect(testDatabaseUrl()).toBeUndefined()

    vi.stubEnv('TEST_DATABASE_URL', '   ')
    expect(testDatabaseUrl()).toBeUndefined()
  })

  it('trims a value that carries whitespace', () => {
    vi.stubEnv('TEST_DATABASE_URL', '  postgresql://u:p@localhost:5432/x_test  ')

    expect(testDatabaseUrl()).toBe('postgresql://u:p@localhost:5432/x_test')
  })
})

describe('hasTestDatabase', () => {
  it('is what a suite guards on', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://u:p@localhost:5432/x_test')
    expect(hasTestDatabase()).toBe(true)

    vi.stubEnv('TEST_DATABASE_URL', '')
    expect(hasTestDatabase()).toBe(false)
  })
})

describe('connectTestDatabase', () => {
  it('refuses when nothing is configured', async () => {
    vi.stubEnv('TEST_DATABASE_URL', '')
    const { connectTestDatabase } = await import('./testing')

    await expect(connectTestDatabase()).rejects.toThrow('TEST_DATABASE_URL is not set')
  })

  /**
   * The rail. Names that merely contain the word are refused too, because the
   * check is a suffix: "kerjacus_test_backup" is a backup, not a scratch
   * database, and truncating it is the accident this prevents.
   */
  it.each([
    'postgresql://u:p@localhost:5432/kerjacus',
    'postgresql://u:p@localhost:5432/production',
    'postgresql://u:p@localhost:5432/kerjacus_test_backup',
    'postgresql://u:p@localhost:5432/test_kerjacus',
  ])('refuses %s', async (url) => {
    vi.stubEnv('TEST_DATABASE_URL', url)
    const { connectTestDatabase } = await import('./testing')

    await expect(connectTestDatabase()).rejects.toThrow(/must end in _test/)
  })

  it('names the database it refused so the fix is obvious', async () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://u:p@localhost:5432/kerjacus')
    const { connectTestDatabase } = await import('./testing')

    await expect(connectTestDatabase()).rejects.toThrow(/"kerjacus"/)
  })

  /** Credentials and query strings must not confuse the suffix check. */
  it('reads the name past credentials and query parameters', async () => {
    vi.stubEnv(
      'TEST_DATABASE_URL',
      'postgresql://user:pa55@db.internal:6432/live_db?sslmode=disable',
    )
    const { connectTestDatabase } = await import('./testing')

    await expect(connectTestDatabase()).rejects.toThrow(/"live_db"/)
  })

  /**
   * The branch that turns an unreachable server into an instruction.
   *
   * Without it a developer with no Postgres running sees a driver stack trace,
   * or four coverage threshold errors naming statements and branches, and both
   * read as their tests being broken rather than their database being absent.
   * Port 5999 has nothing listening.
   */
  it('names the command that fixes an unreachable server', async () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://u:p@localhost:5999/unreachable_test')
    const { connectTestDatabase } = await import('./testing')

    await expect(connectTestDatabase()).rejects.toThrow(/bun run db:test:setup/)
  }, 30_000)

  /** The URL is echoed back, so the password must not be. */
  it('redacts the password when reporting the failure', async () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://u:hunter2@localhost:5999/unreachable_test')
    const { connectTestDatabase } = await import('./testing')

    await expect(connectTestDatabase()).rejects.toThrow(/:\*\*\*@/)
    await expect(connectTestDatabase()).rejects.not.toThrow(/hunter2/)
  }, 30_000)
})

/**
 * Teardown has to survive the app's own pool.
 *
 * TRUNCATE wants AccessExclusiveLock on every table while a request that is
 * still committing holds a row lock through a foreign key check, so Postgres
 * reports a deadlock and kills one of them. It turned main red on a commit
 * whose own pull request had passed. The blocker is finishing, not waiting, so
 * the next attempt finds the locks gone.
 */
describe('truncateAll under lock contention', () => {
  const TABLES = [{ table_name: 'projects' }]

  // The first execute is the table-name lookup; every one after it is the
  // truncate. Matching on the SQL text is not available here: drizzle passes a
  // template object whose chunks do not stringify.
  function fakeDb(failures: unknown[]) {
    const calls: string[] = []
    const queue = [...failures]
    let first = true
    return {
      calls,
      db: {
        execute: async () => {
          if (first) {
            first = false
            return TABLES
          }
          calls.push('truncate')
          const next = queue.shift()
          if (next) throw next
          return []
        },
      } as never,
    }
  }

  const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' })
  const lockTimeout = () => Object.assign(new Error('timeout'), { cause: { code: '55P03' } })

  it('retries a deadlock and succeeds', async () => {
    const { db, calls } = fakeDb([deadlock()])

    await truncateAll(db)

    expect(calls).toHaveLength(2)
  })

  /** drizzle wraps the driver error, so the code sits under cause. */
  it('retries a lock timeout reported one level down', async () => {
    const { db, calls } = fakeDb([lockTimeout()])

    await truncateAll(db)

    expect(calls).toHaveLength(2)
  })

  /** A truncate that never lands leaves the next test dirty; say so. */
  it('gives up rather than looping for ever', async () => {
    const { db, calls } = fakeDb([deadlock(), deadlock(), deadlock(), deadlock()])

    await expect(truncateAll(db)).rejects.toThrow('deadlock detected')
    expect(calls).toHaveLength(4)
  })

  /** Anything else is a real failure and must not be retried into silence. */
  it('rethrows a non-contention error immediately', async () => {
    const { db, calls } = fakeDb([Object.assign(new Error('syntax error'), { code: '42601' })])

    await expect(truncateAll(db)).rejects.toThrow('syntax error')
    expect(calls).toHaveLength(1)
  })

  it('does nothing when the schema has no tables', async () => {
    const empty = { execute: async () => [] } as never

    await expect(truncateAll(empty)).resolves.toBeUndefined()
  })
})
