import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from './testing'

/**
 * A seeded milestone the auto-release sweep will pick up must have the money
 * behind it.
 *
 * `findOverdueSubmitted` hands every `submitted` milestone past its review
 * window to the release, and the release resolves escrow per work package
 * (migration 0023). The seed funded escrow per project and then rebuilt every
 * ledger entry - and every balance from it - at project granularity in the
 * reconciliation pass, so the per work package pools it had just written were
 * zeroed a few hundred lines later. Nothing in the seed noticed: the numbers
 * still added up, just against pools no release ever reads. Production found
 * it hourly instead, three milestones at a time:
 *
 *   insufficient escrow balance: 0 < 21000000   (ms10, work package wp6)
 *   no escrow account holds funds for <wp19>    (ms24, project never funded)
 *   insufficient escrow balance: 0 < 6000000    (ms6,  work package wp3)
 *
 * So this runs the real seed and asserts the invariant over the result, rather
 * than restating fixtures that would drift from it. The last two cases are the
 * reconciliation's own contract: a split that loses or invents a rupiah shows
 * up as a transaction whose legs do not net to zero, and the exact-fit pools
 * (wp6 holds 21,000,000 for a 21,000,000 milestone) leave no slack to absorb
 * one.
 *
 * It takes its own database, for the reason the neighbouring suites give: the
 * seed opens with a TRUNCATE and project-service runs at the same time under
 * turbo.
 */

const OWN_DATABASE = process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, '/kerjacus_seed_test')
const SEED = new URL('./seed.ts', import.meta.url).pathname
const run = promisify(execFile)

/** The seed runs as its own process: it reads env and exits when it is done. */
async function runSeed(databaseUrl: string): Promise<void> {
  // Belt and braces over the harness's own `_test` rail. That rail would let
  // this truncate kerjacus_test, which is the database 28 other integration
  // suites are using.
  if (!databaseUrl.endsWith('/kerjacus_seed_test')) {
    throw new Error(`Refusing to seed ${databaseUrl}: this suite owns kerjacus_seed_test only.`)
  }
  await run('bun', ['run', SEED], {
    cwd: dirname(SEED),
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_DIRECT_URL: databaseUrl },
    // The seed writes every table in the schema; CI is slower than a laptop.
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  })
}

describe.skipIf(!hasTestDatabase())('seeded escrow covers every releasable milestone', () => {
  let handle: TestHandle
  let previous: string | undefined

  beforeAll(async () => {
    previous = process.env.TEST_DATABASE_URL
    if (OWN_DATABASE) process.env.TEST_DATABASE_URL = OWN_DATABASE
    // Connecting migrates. The seed truncates on its own, so nothing else has
    // to prepare the database.
    handle = await connectTestDatabase()
    await runSeed(process.env.TEST_DATABASE_URL ?? '')
  }, 300_000)

  afterAll(async () => {
    await handle.close()
    process.env.TEST_DATABASE_URL = previous
  })

  /**
   * Status alone, not `submitted_at < now() - 14 days`. The seeded dates are
   * fixed, so a cutoff makes this suite's coverage depend on the wall clock and
   * go vacuous the day it stops matching. Every submitted milestone becomes
   * releasable eventually, so the invariant holds unconditionally.
   */
  it('funds the pool every submitted milestone draws from', async () => {
    const unfunded = await handle.db.execute<{
      id: string
      amount: number
      balance: number | null
    }>(sql`
      SELECT m.id, m.amount, ea.balance
        FROM milestones m
        LEFT JOIN accounts ea
               ON ea.owner_type = 'escrow'
              AND ea.owner_id = COALESCE(m.work_package_id, m.project_id)
       WHERE m.status = 'submitted'
         AND (ea.id IS NULL OR ea.balance < m.amount)`)

    expect([...unfunded]).toEqual([])
  })

  /** Otherwise the query above passes on a seed that grew no such milestone. */
  it('still seeds submitted milestones for the sweep to find', async () => {
    const rows = await handle.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM milestones WHERE status = 'submitted'`,
    )

    expect([...rows][0]?.n).toBeGreaterThan(0)
  })

  /** The settle path refuses a milestone priced above its own work package. */
  it('prices no submitted milestone above its work package', async () => {
    const overpriced = await handle.db.execute<{ id: string }>(sql`
      SELECT m.id
        FROM milestones m
        JOIN work_packages wp ON wp.id = m.work_package_id
       WHERE m.status = 'submitted' AND m.amount > wp.amount`)

    expect([...overpriced]).toEqual([])
  })

  it('nets every transaction to zero across its ledger legs', async () => {
    const unbalanced = await handle.db.execute<{ transaction_id: string; net: number }>(sql`
      SELECT transaction_id,
             SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END)::int AS net
        FROM ledger_entries
       GROUP BY transaction_id
      HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) <> 0`)

    expect([...unbalanced]).toEqual([])
  })

  it('derives every balance from the ledger', async () => {
    const drifted = await handle.db.execute<{ id: string; balance: number; ledger: number }>(sql`
      SELECT a.id, a.balance,
             COALESCE((SELECT SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount
                                       ELSE -le.amount END)
                         FROM ledger_entries le
                        WHERE le.account_id = a.id), 0)::int AS ledger
        FROM accounts a
       WHERE a.balance <> COALESCE((SELECT SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount
                                                    ELSE -le.amount END)
                                      FROM ledger_entries le
                                     WHERE le.account_id = a.id), 0)`)

    expect([...drifted]).toEqual([])
  })
})
