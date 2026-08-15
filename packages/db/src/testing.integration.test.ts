import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { user } from './schema'
import { connectTestDatabase, hasTestDatabase, type TestHandle, truncateAll } from './testing'

/**
 * The harness, exercised against a real server.
 *
 * Its own database rather than the one project-service uses. Both workspaces
 * run at once under turbo and this truncates every table, so sharing would mean
 * wiping rows out from under 28 integration suites. The name still ends in
 * `_test`, which is what the rail requires.
 */

const OWN_DATABASE = process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, '/kerjacus_dbself_test')
const runIf = hasTestDatabase() ? describe : describe.skip

runIf('connectTestDatabase against Postgres', () => {
  let handle: TestHandle
  let previous: string | undefined

  beforeAll(async () => {
    previous = process.env.TEST_DATABASE_URL
    if (OWN_DATABASE) process.env.TEST_DATABASE_URL = OWN_DATABASE
    handle = await connectTestDatabase()
  }, 120_000)

  afterAll(async () => {
    await handle.close()
    process.env.TEST_DATABASE_URL = previous
  })

  /** Migrating is the point: an empty database is not a usable one. */
  it('runs the migrations on connect', async () => {
    const rows = await handle.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `)

    expect([...rows][0]?.n).toBeGreaterThan(30)
  })

  it('empties a table it was given rows in', async () => {
    await handle.db
      .insert(user)
      .values({ id: 'u-1', email: 'a@example.test', name: 'A', emailVerified: false })

    await handle.truncate()

    expect(await handle.db.select().from(user)).toHaveLength(0)
  })

  /**
   * The drizzle bookkeeping table survives, or the next suite re-runs all the
   * migrations and pays for them again.
   */
  it('leaves the migration record in place', async () => {
    await handle.truncate()

    const rows = await handle.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'drizzle'
    `)

    expect([...rows][0]?.n).toBeGreaterThan(0)
  })

  it('is safe to call on an already-empty database', async () => {
    await handle.truncate()

    await expect(truncateAll(handle.db)).resolves.toBeUndefined()
  })

  /** A second connect must not re-apply migrations or fail on them. */
  it('connects again without re-running what is already applied', async () => {
    const second = await connectTestDatabase()

    await expect(second.db.select().from(user)).resolves.toEqual([])

    await second.close()
  })
})

/**
 * truncateAll against a database with no tables at all.
 *
 * The early return exists because TRUNCATE with an empty table list is a
 * syntax error, not a no-op. A database that has not been migrated yet is the
 * real case: connect, fail mid-migration, then have a teardown call truncate
 * on what was never built.
 */
const emptyDatabase = process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, '/kerjacus_empty_test')

;(hasTestDatabase() ? describe : describe.skip)('truncateAll with nothing to truncate', () => {
  it('returns without issuing a statement', async () => {
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const client = postgres(emptyDatabase as string, { max: 1, onnotice: () => {} })
    const db = drizzle(client)

    await expect(truncateAll(db as never)).resolves.toBeUndefined()

    await client.end({ timeout: 5 })
  }, 30_000)
})
