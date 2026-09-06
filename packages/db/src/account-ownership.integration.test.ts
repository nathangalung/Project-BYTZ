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
 */
describe.skipIf(!hasTestDatabase())('accounts.owner_id points at the right table', () => {
  let handle: TestHandle

  beforeAll(async () => {
    handle = await connectTestDatabase()
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function count(query: ReturnType<typeof sql>): Promise<number> {
    const rows = (await handle.db.execute(query)) as unknown as Array<{ n: number | string }>
    return Number(rows[0]?.n ?? 0)
  }

  it('resolves every talent account to a talent_profile', async () => {
    const orphans = await count(sql`
      SELECT count(*)::int AS n FROM accounts a
      WHERE a.owner_type = 'talent'
        AND NOT EXISTS (SELECT 1 FROM talent_profiles tp WHERE tp.id = a.owner_id)`)
    expect(orphans).toBe(0)
  })

  /**
   * The failure mode was a talent account holding a user id, which reads as an
   * orphan above but is worth naming on its own: it is the exact shape the
   * seed produced, and it looks valid to anyone glancing at the column.
   */
  it('never stores a user id on a talent account', async () => {
    const misdirected = await count(sql`
      SELECT count(*)::int AS n FROM accounts a
      WHERE a.owner_type = 'talent'
        AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.owner_id)
        AND NOT EXISTS (SELECT 1 FROM talent_profiles tp WHERE tp.id = a.owner_id)`)
    expect(misdirected).toBe(0)
  })

  it('resolves every owner account to a user', async () => {
    const orphans = await count(sql`
      SELECT count(*)::int AS n FROM accounts a
      WHERE a.owner_type = 'owner'
        AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.owner_id)`)
    expect(orphans).toBe(0)
  })

  /**
   * Escrow is polymorphic on purpose: a project-level deposit owns the project,
   * a per-package one owns the work package, and the seed carries both. What
   * must never happen is an escrow account owning neither, because the balance
   * on it is then unreachable from either side.
   */
  it('resolves every escrow account to a project or a work package', async () => {
    const orphans = await count(sql`
      SELECT count(*)::int AS n FROM accounts a
      WHERE a.owner_type = 'escrow'
        AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = a.owner_id)
        AND NOT EXISTS (SELECT 1 FROM work_packages w WHERE w.id = a.owner_id)`)
    expect(orphans).toBe(0)
  })

  /** Platform accounts belong to nobody, so the column stays null. */
  it('leaves platform accounts unowned', async () => {
    const owned = await count(sql`
      SELECT count(*)::int AS n FROM accounts
      WHERE owner_type = 'platform' AND owner_id IS NOT NULL`)
    expect(owned).toBe(0)
  })
})
