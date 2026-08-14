import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Real Postgres for tests that cannot be written without one.
 *
 * Repositories, transactions, the CAS guards and the ledger only mean anything
 * when they execute. Without a database those tests were written as regex over
 * source text instead, which is why project-service ran 997 tests for 37%
 * coverage. CI has provisioned pgvector Postgres for the test job all along and
 * nothing connected to it.
 *
 * Safety rail: every entry point refuses a database whose name does not end in
 * `_test`. Truncation is involved and the dev database usually sits on the same
 * server, so the check is a hard error rather than a warning.
 */

const MIGRATIONS = new URL('../migrations', import.meta.url).pathname

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

export type TestHandle = {
  readonly db: TestDatabase
  /** Empty every table, keeping the schema. */
  readonly truncate: () => Promise<void>
  readonly close: () => Promise<void>
}

/** Unset means the suite skips rather than fails on a missing server. */
export function testDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL?.trim() || undefined
}

export function hasTestDatabase(): boolean {
  return testDatabaseUrl() !== undefined
}

function assertTestDatabase(url: string): void {
  // pathname is "/name"; query strings and credentials are ignored.
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}". The name must end in _test, because this harness truncates every table.`,
    )
  }
}

/**
 * Connect, migrate once, and hand back a truncating handle.
 *
 * Migrations run per connection rather than per suite. drizzle records what it
 * applied, so the second suite is a no-op read.
 */
export async function connectTestDatabase(): Promise<TestHandle> {
  const url = testDatabaseUrl()
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Guard the suite with hasTestDatabase() first.')
  }
  assertTestDatabase(url)

  // One connection: suites run sequentially against this handle and a pool
  // only adds ways for a truncate to race a query.
  const client = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle(client, { schema })

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS })
  } catch (cause) {
    // Unreachable server reads as a broken test suite otherwise, and the
    // coverage thresholds assume these ran, so the failure needs to name its
    // own fix rather than surface as four threshold errors.
    await client.end({ timeout: 5 }).catch(() => {})
    throw new Error(
      `Could not prepare the test database at ${url.replace(/:[^:@]*@/, ':***@')}. Run \`bun run db:test:setup\` to start Postgres and create it.`,
      { cause },
    )
  }

  return {
    db,
    truncate: async () => {
      await truncateAll(db)
    },
    close: async () => {
      await client.end({ timeout: 5 })
    },
  }
}

/**
 * Empty every table in one statement.
 *
 * CASCADE rather than ordering the deletes by dependency, and RESTART IDENTITY
 * so a sequence does not leak a row count between tests. The drizzle bookkeeping
 * table is excluded or the next suite would re-run all 34 migrations.
 */
export async function truncateAll(db: TestDatabase): Promise<void> {
  const rows = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE '__drizzle%'
  `)

  const names = [...rows].map((r) => `"public"."${r.table_name}"`)
  if (names.length === 0) return

  await db.execute(sql.raw(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`))
}
