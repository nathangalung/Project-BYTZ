import { readFileSync } from 'node:fs'
import { computeProjectPricing, projectTalentPayout } from '@kerjacus/shared'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from './testing'

/**
 * Migration 0048 and packages/shared/src/pricing.ts have to agree to the rupiah.
 *
 * The migration restates projectTalentPayout as SQL, because the prod migrate
 * step is `drizzle-kit migrate` in a container with no application code. Two
 * implementations of one bracket table is exactly the drift that broke the
 * rows it repairs: #62 moved the table, the stored payouts stayed on the old
 * one, and ProjectPayoutMatchesBracket in payment-service - which re-derives
 * the payout from final_price and compares - then refused every milestone
 * release. So this suite runs the migration's own SQL against rows carrying the
 * pre-#62 numbers and asserts the result equals what the TypeScript engine
 * computes, which is the only thing that holds the two together.
 *
 * It takes its own database. connectTestDatabase runs migrations and the
 * harness truncates every table, so sharing one with project-service under
 * turbo means issuing DDL into another suite's traffic; account-ownership and
 * testing.integration already take their own for the same reason.
 */

const OWN_DATABASE = process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, '/kerjacus_pricing_test')

const MIGRATION = new URL('../migrations/0048_pricing_payout_rederive.sql', import.meta.url)
  .pathname

/**
 * The bracket table #62 replaced, kept here as a fixture generator.
 *
 * Not imported from anywhere: it is gone from the tree, and the point of these
 * rows is to be the shape prod is actually in. Marginal, as it was then, so the
 * stale values are the ones the old engine really wrote rather than an
 * arbitrary wrong number that any recompute would repair.
 */
const OLD_BRACKETS: readonly (readonly [number, number])[] = [
  [3_000_000, 0.8725],
  [5_000_000, 0.8225],
  [10_000_000, 0.7725],
  [15_000_000, 0.7225],
  [20_000_000, 0.6725],
  [30_000_000, 0.6225],
  [50_000_000, 0.5725],
]
const OLD_TOP_SHARE = 0.5475

function oldPayout(finalPrice: number): number {
  let payout = 0
  let prev = 0
  for (const [maxFee, share] of OLD_BRACKETS) {
    if (finalPrice <= prev) break
    payout += (Math.min(finalPrice, maxFee) - prev) * share
    prev = maxFee
  }
  if (finalPrice > prev) payout += (finalPrice - prev) * OLD_TOP_SHARE
  return Math.round(payout)
}

/** One price per band, both band edges, and the top band. */
const SAMPLE_PRICES = [
  3_000_000, 4_000_000, 10_000_000, 15_000_000, 23_000_000, 50_000_000, 60_000_000, 100_000_000,
  150_000_000,
]

const OWNER = 'pricing-owner'
/** Packages summing to the project price: the shape computeProjectPricing makes. */
const PACKAGED_PROJECT = 'pricing-packaged'
const PACKAGE_AMOUNTS = [7_000_000, 11_500_000, 4_500_000]
/** Packages that do NOT sum to the price: no remainder to place. */
const SKEWED_PROJECT = 'pricing-skewed'
const SKEWED_PRICE = 23_000_000
const SKEWED_AMOUNTS = [9_000_000, 5_000_000]

type MoneyRow = { id: string; final_price: number; talent_payout: number; platform_fee: number }
type PackageRow = { id: string; amount: number; talent_payout: number }

describe.skipIf(!hasTestDatabase())('migration 0048 re-derives stored payouts', () => {
  let handle: TestHandle
  let previous: string | undefined

  beforeAll(async () => {
    previous = process.env.TEST_DATABASE_URL
    if (OWN_DATABASE) process.env.TEST_DATABASE_URL = OWN_DATABASE
    handle = await connectTestDatabase()
    await handle.truncate()
    await seedStaleRows()
    await runMigration()
  }, 120_000)

  afterAll(async () => {
    await handle.close()
    process.env.TEST_DATABASE_URL = previous
  })

  /** Execute the migration file the way drizzle does: one statement at a time. */
  async function runMigration(): Promise<void> {
    const statements = readFileSync(MIGRATION, 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const statement of statements) {
      await handle.db.execute(sql.raw(statement))
    }
  }

  async function seedProject(id: string, finalPrice: number): Promise<void> {
    const stale = oldPayout(finalPrice)
    await handle.db.execute(sql`
      INSERT INTO projects
        (id, owner_id, title, description, category, budget_min, budget_max,
         estimated_timeline_days, final_price, talent_payout, platform_fee)
      VALUES
        (${id}, ${OWNER}, ${`Priced at ${finalPrice}`}, 'Pre-#62 pricing', 'web_app',
         ${finalPrice}, ${finalPrice}, 30, ${finalPrice}, ${stale}, ${finalPrice - stale})`)
  }

  async function seedPackages(projectId: string, amounts: number[], price: number): Promise<void> {
    const share = oldPayout(price) / price
    for (const [i, amount] of amounts.entries()) {
      await handle.db.execute(sql`
        INSERT INTO work_packages
          (id, project_id, title, description, order_index, required_skills,
           estimated_hours, amount, talent_payout)
        VALUES
          (${`${projectId}-wp-${i}`}, ${projectId}, ${`Package ${i}`}, 'Pre-#62 payout',
           ${i}, '[]'::jsonb, 40, ${amount}, ${Math.round(amount * share)})`)
    }
  }

  /** Every row carries the number the OLD bracket table produced. */
  async function seedStaleRows(): Promise<void> {
    await handle.db.execute(sql`
      INSERT INTO "user" (id, name, email, role)
      VALUES (${OWNER}, 'Owner', 'owner@pricing.test', 'owner')`)
    for (const price of SAMPLE_PRICES) await seedProject(`pricing-${price}`, price)

    const packagedPrice = PACKAGE_AMOUNTS.reduce((sum, a) => sum + a, 0)
    await seedProject(PACKAGED_PROJECT, packagedPrice)
    await seedPackages(PACKAGED_PROJECT, PACKAGE_AMOUNTS, packagedPrice)

    await seedProject(SKEWED_PROJECT, SKEWED_PRICE)
    await seedPackages(SKEWED_PROJECT, SKEWED_AMOUNTS, SKEWED_PRICE)
  }

  async function projectRow(id: string): Promise<MoneyRow> {
    const rows = (await handle.db.execute(sql`
      SELECT id, final_price, talent_payout, platform_fee FROM projects WHERE id = ${id}`)) as unknown as MoneyRow[]
    return rows[0] as MoneyRow
  }

  async function packageRows(projectId: string): Promise<PackageRow[]> {
    return (await handle.db.execute(sql`
      SELECT id, amount, talent_payout FROM work_packages
      WHERE project_id = ${projectId} ORDER BY order_index`)) as unknown as PackageRow[]
  }

  it.each(SAMPLE_PRICES)(
    'brackets a project priced at %i to the payout the shared engine computes',
    async (price) => {
      const row = await projectRow(`pricing-${price}`)
      const expected = projectTalentPayout(price)

      // Vacuous otherwise: a recompute that changed nothing proves nothing.
      expect(oldPayout(price)).not.toBe(expected)
      expect(Number(row.talent_payout)).toBe(expected)
      expect(Number(row.platform_fee)).toBe(price - expected)
      expect(Number(row.talent_payout) + Number(row.platform_fee)).toBe(price)
    },
  )

  it('allocates packages exactly as computeProjectPricing does', async () => {
    const pricing = computeProjectPricing(PACKAGE_AMOUNTS.map((amount) => ({ amount })))
    const project = await projectRow(PACKAGED_PROJECT)
    const packages = await packageRows(PACKAGED_PROJECT)

    expect(Number(project.talent_payout)).toBe(pricing.talentPayout)
    expect(packages.map((p) => Number(p.talent_payout))).toEqual(pricing.packagePayouts)
    // The invariant milestone settlement depends on: packages sum to the project.
    expect(packages.reduce((sum, p) => sum + Number(p.talent_payout), 0)).toBe(pricing.talentPayout)
  })

  /**
   * Packages that do not sum to the price get the plain pro-rata share. Forcing
   * them to sum to the project payout would push the whole difference onto one
   * package and break the payout/amount ratio MilestoneFee divides by.
   */
  it('keeps the project ratio on packages that do not sum to the price', async () => {
    const payout = projectTalentPayout(SKEWED_PRICE)
    const packages = await packageRows(SKEWED_PROJECT)

    expect(packages.map((p) => Number(p.talent_payout))).toEqual(
      SKEWED_AMOUNTS.map((amount) => Math.round((amount * payout) / SKEWED_PRICE)),
    )
    for (const p of packages) expect(Number(p.talent_payout)).toBeLessThanOrEqual(Number(p.amount))
  })

  /**
   * Re-running writes nothing at all, not merely the same values: xmin is the
   * transaction that last wrote the row, so an UPDATE that rewrites a row with
   * identical contents still moves it. A restored snapshot that predates this
   * migration can therefore be replayed by hand without churning the table.
   */
  it('touches no row when run a second time', async () => {
    const before = await handle.db.execute(sql`
      SELECT id, xmin::text AS version FROM projects
      UNION ALL SELECT id, xmin::text FROM work_packages ORDER BY id`)
    await runMigration()
    const after = await handle.db.execute(sql`
      SELECT id, xmin::text AS version FROM projects
      UNION ALL SELECT id, xmin::text FROM work_packages ORDER BY id`)

    expect(after).toEqual(before)
  })
})
