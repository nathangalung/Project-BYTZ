import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from './testing'

/**
 * accounts.owner_id is polymorphic, and which id each owner_type carries is a
 * contract between the seed and two readers in payment-service.
 *
 * It was broken for talent. The seed wrote the user id while
 * GetSummaryByUser joins accounts.owner_id to talent_profiles.id, and the
 * release path writes that same profile id through GetOrCreateAccountTx. The
 * join therefore matched nothing and every talent saw "Total Earned Rp 0" no
 * matter what they had been paid. On the deployed database one talent had a
 * balance of Rp 9,000,000 from two completed releases and was shown zero.
 *
 * Nothing failed. There is no foreign key on a polymorphic column, the query
 * returns 0 rather than an error, and COALESCE turns that into a plausible
 * number. This asserts the contract that nothing else can.
 *
 * Two things about how it runs, both learned the hard way.
 *
 * It takes its own database. It used to share TEST_DATABASE_URL with
 * project-service, and connectTestDatabase runs migrations, so this file was
 * issuing DDL against the same database project-service was truncating and
 * inserting into from a workspace turbo runs in parallel. That surfaced as
 * "PostgresError: deadlock detected" in an unrelated chat-stream suite, rarely
 * enough to look like noise. testing.integration.test.ts already took its own
 * database for the neighbouring reason and said so; this file simply never
 * got the same treatment.
 *
 * It seeds, and every case proves its own query. Each assertion counts orphan
 * rows, so on an empty table all of them pass while checking nothing - which
 * is exactly what they were doing, because the database they shared was being
 * truncated continuously. Seeding alone would not fix that: a query with a
 * typo in it also returns zero. So each case seeds the valid shape, asserts
 * zero, then writes the broken row the production bug actually produced and
 * asserts the query catches it.
 */

const OWN_DATABASE = process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, '/kerjacus_accounts_test')

const OWNER_USER = 'acct-owner-user'
const TALENT_USER = 'acct-talent-user'
const TALENT_PROFILE = 'acct-talent-profile'
const PROJECT = 'acct-project'
const WORK_PACKAGE = 'acct-work-package'

describe.skipIf(!hasTestDatabase())('accounts.owner_id points at the right table', () => {
  let handle: TestHandle
  let previous: string | undefined

  beforeAll(async () => {
    previous = process.env.TEST_DATABASE_URL
    if (OWN_DATABASE) process.env.TEST_DATABASE_URL = OWN_DATABASE
    handle = await connectTestDatabase()
    await handle.truncate()
    await seed()
  }, 120_000)

  afterAll(async () => {
    await handle.close()
    process.env.TEST_DATABASE_URL = previous
  })

  /** One correct row per owner_type, which is what the queries expect to find. */
  async function seed(): Promise<void> {
    const db = handle.db
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, role) VALUES
        (${OWNER_USER}, 'Owner', 'owner@accounts.test', 'owner'),
        (${TALENT_USER}, 'Talent', 'talent@accounts.test', 'talent')`)
    await db.execute(sql`
      INSERT INTO talent_profiles (id, user_id) VALUES (${TALENT_PROFILE}, ${TALENT_USER})`)
    await db.execute(sql`
      INSERT INTO projects
        (id, owner_id, title, description, category, budget_min, budget_max,
         estimated_timeline_days)
      VALUES
        (${PROJECT}, ${OWNER_USER}, 'Accounts fixture', 'Ownership contract',
         'web_app', 1000000, 2000000, 30)`)
    await db.execute(sql`
      INSERT INTO work_packages
        (id, project_id, title, description, order_index, required_skills,
         estimated_hours, amount, talent_payout)
      VALUES
        (${WORK_PACKAGE}, ${PROJECT}, 'Backend', 'API work', 0, '[]'::jsonb,
         40, 1000000, 715000)`)
    await db.execute(sql`
      INSERT INTO accounts (id, owner_type, owner_id, account_type, name) VALUES
        ('acct-owner',     'owner',    ${OWNER_USER},     'liability', 'Owner'),
        ('acct-talent',    'talent',   ${TALENT_PROFILE}, 'liability', 'Talent payout'),
        ('acct-escrow-p',  'escrow',   ${PROJECT},        'asset',     'Escrow, project'),
        ('acct-escrow-w',  'escrow',   ${WORK_PACKAGE},   'asset',     'Escrow, package'),
        ('acct-platform',  'platform', NULL,              'revenue',   'Platform revenue')`)
  }

  async function count(query: ReturnType<typeof sql>): Promise<number> {
    const rows = (await handle.db.execute(query)) as unknown as Array<{ n: number | string }>
    return Number(rows[0]?.n ?? 0)
  }

  /** Insert a row the invariant forbids, read the count back, remove it again. */
  async function withBrokenRow(values: ReturnType<typeof sql>): Promise<void> {
    await handle.db.execute(
      sql`INSERT INTO accounts (id, owner_type, owner_id, account_type, name) VALUES ${values}`,
    )
  }

  async function dropBrokenRow(id: string): Promise<void> {
    await handle.db.execute(sql`DELETE FROM accounts WHERE id = ${id}`)
  }

  const talentOrphans = sql`
    SELECT count(*)::int AS n FROM accounts a
    WHERE a.owner_type = 'talent'
      AND NOT EXISTS (SELECT 1 FROM talent_profiles tp WHERE tp.id = a.owner_id)`

  it('resolves every talent account to a talent_profile', async () => {
    expect(await count(talentOrphans)).toBe(0)
  })

  it('counts a talent account that resolves to nothing', async () => {
    await withBrokenRow(sql`('acct-bad-talent', 'talent', 'no-such-profile', 'liability', 'Bad')`)
    try {
      expect(await count(talentOrphans)).toBe(1)
    } finally {
      await dropBrokenRow('acct-bad-talent')
    }
  })

  /**
   * The failure mode was a talent account holding a user id, which reads as an
   * orphan above but is worth naming on its own: it is the exact shape the
   * seed produced, and it looks valid to anyone glancing at the column.
   */
  const misdirectedTalent = sql`
    SELECT count(*)::int AS n FROM accounts a
    WHERE a.owner_type = 'talent'
      AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.owner_id)
      AND NOT EXISTS (SELECT 1 FROM talent_profiles tp WHERE tp.id = a.owner_id)`

  it('never stores a user id on a talent account', async () => {
    expect(await count(misdirectedTalent)).toBe(0)
  })

  it('catches the user id the production seed actually wrote', async () => {
    await dropBrokenRow('acct-talent')
    await withBrokenRow(
      sql`('acct-talent', 'talent', ${TALENT_USER}, 'liability', 'Talent payout')`,
    )
    try {
      expect(await count(misdirectedTalent)).toBe(1)
    } finally {
      await dropBrokenRow('acct-talent')
      await withBrokenRow(
        sql`('acct-talent', 'talent', ${TALENT_PROFILE}, 'liability', 'Talent payout')`,
      )
    }
  })

  const ownerOrphans = sql`
    SELECT count(*)::int AS n FROM accounts a
    WHERE a.owner_type = 'owner'
      AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.owner_id)`

  it('resolves every owner account to a user', async () => {
    expect(await count(ownerOrphans)).toBe(0)
  })

  it('counts an owner account that resolves to nothing', async () => {
    await withBrokenRow(sql`('acct-bad-owner', 'owner', 'no-such-user', 'liability', 'Bad')`)
    try {
      expect(await count(ownerOrphans)).toBe(1)
    } finally {
      await dropBrokenRow('acct-bad-owner')
    }
  })

  /**
   * Escrow is polymorphic on purpose: a project-level deposit owns the project,
   * a per-package one owns the work package, and the seed carries both. What
   * must never happen is an escrow account owning neither, because the balance
   * on it is then unreachable from either side.
   */
  const escrowOrphans = sql`
    SELECT count(*)::int AS n FROM accounts a
    WHERE a.owner_type = 'escrow'
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = a.owner_id)
      AND NOT EXISTS (SELECT 1 FROM work_packages w WHERE w.id = a.owner_id)`

  it('resolves every escrow account to a project or a work package', async () => {
    expect(await count(escrowOrphans)).toBe(0)
  })

  it('accepts both escrow shapes rather than only the project one', async () => {
    const byPackage = await count(sql`
      SELECT count(*)::int AS n FROM accounts a
      WHERE a.owner_type = 'escrow'
        AND EXISTS (SELECT 1 FROM work_packages w WHERE w.id = a.owner_id)`)
    expect(byPackage).toBe(1)
  })

  it('counts an escrow account owning neither', async () => {
    await withBrokenRow(sql`('acct-bad-escrow', 'escrow', 'no-such-thing', 'asset', 'Bad')`)
    try {
      expect(await count(escrowOrphans)).toBe(1)
    } finally {
      await dropBrokenRow('acct-bad-escrow')
    }
  })

  /** Platform accounts belong to nobody, so the column stays null. */
  const ownedPlatform = sql`
    SELECT count(*)::int AS n FROM accounts
    WHERE owner_type = 'platform' AND owner_id IS NOT NULL`

  it('leaves platform accounts unowned', async () => {
    expect(await count(ownedPlatform)).toBe(0)
  })

  it('counts a platform account that claims an owner', async () => {
    await withBrokenRow(sql`('acct-bad-platform', 'platform', ${OWNER_USER}, 'revenue', 'Bad')`)
    try {
      expect(await count(ownedPlatform)).toBe(1)
    } finally {
      await dropBrokenRow('acct-bad-platform')
    }
  })
})
