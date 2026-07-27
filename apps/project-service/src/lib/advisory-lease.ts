import { getDb } from '@kerjacus/db'
import { sql } from 'drizzle-orm'

/**
 * Run `fn` only on the replica that wins the Postgres advisory lease `key`.
 * Returns null when another replica already holds it.
 *
 * The lock is transaction-scoped, not session-scoped, because the db handle is
 * a connection pool: `pg_advisory_lock` taken on one pooled connection cannot
 * be released from another, so the unlock would silently fail and wedge the
 * lease until that connection died. The transaction exists only to pin the lock
 * to a single connection for the duration -- `fn` writes through the pool and
 * each of its statements commits on its own, so a failure part-way through does
 * not roll back the work already done.
 *
 * That also means `fn` must stay short: an open transaction holds back vacuum
 * for as long as the lease is held.
 */
export async function withAdvisoryLease<T>(key: number, fn: () => Promise<T>): Promise<T | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked`,
    )) as unknown as { locked: boolean }[]

    if (!rows[0]?.locked) return null
    return await fn()
  })
}
