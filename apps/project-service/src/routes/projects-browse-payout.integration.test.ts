// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import { getDb, projects as projectsTable, user, workPackages } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import { projectsRoute } from './projects'

/**
 * What money a talent reads before deciding to apply.
 *
 * Both browse feeds returned budget_min and budget_max, the range the owner
 * typed at intake before the AI priced anything. Measured against the seeded
 * browse list, a project advertising "Rp 45-70 jt" held three work packages
 * whose open seats paid Rp 8,34-12,04 jt: the number driving the decision was
 * roughly five times the number on offer. final_price and talent_payout were
 * both already set on every browsable project, so the real figure existed and
 * was simply not selected.
 *
 * The seat payout is derived at read from work_packages rather than stored,
 * following pemerataan_skor and health_score. Open means the same thing here
 * as it does on the apply path - unassigned or declined - because this listing
 * is what leads to it.
 *
 * project-level final_price, platform_fee and talent_payout stay stripped. The
 * fee framing depends on the margin staying invisible, and a seat payout alone
 * does not reveal it.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
// The id every project-service integration suite shares: they truncate the
// same database, so a private lock would let this one wipe another's fixtures.
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function app() {
  const a = new Hono()
  a.onError(errorHandler)
  a.route('/', projectsRoute)
  return a
}

type ListBody = {
  data: {
    items: Array<{
      id: string
      payoutMin: number | null
      payoutMax: number | null
      openPositions: number
      budgetMin?: unknown
      finalPrice?: unknown
      platformFee?: unknown
      talentPayout?: unknown
    }>
  }
}

const FEEDS = ['/public', '/available'] as const

runIf('browse feeds quote the seat, not the intake guess', () => {
  let handle: TestHandle
  let ownerId: string
  let projectId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function makePackage(payout: number, status: 'unassigned' | 'declined' | 'assigned') {
    await handle.db.insert(workPackages).values({
      id: uuidv7(),
      projectId,
      title: `Package ${payout}`,
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: payout * 2,
      talentPayout: payout,
      status,
    })
  }

  async function items(feed: string): Promise<ListBody['data']['items']> {
    const res = await app().request(feed)
    expect(res.status).toBe(200)
    return ((await res.json()) as ListBody).data.items
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `owner-${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    projectId = uuidv7()
    await handle.db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      title: 'Warehouse management system',
      description: 'A'.repeat(300),
      category: 'web_app',
      budgetMin: 45_000_000,
      budgetMax: 70_000_000,
      estimatedTimelineDays: 120,
      status: 'team_forming',
      visibility: 'public_summary',
      teamSize: 3,
      finalPrice: 65_000_000,
      platformFee: 34_775_000,
      talentPayout: 30_225_000,
    })
  })

  for (const feed of FEEDS) {
    describe(`GET /projects${feed}`, () => {
      it('quotes the payout range of the seats a talent can still take', async () => {
        await makePackage(8_342_647, 'unassigned')
        await makePackage(9_847_353, 'declined')
        await makePackage(12_035_294, 'assigned')

        const [row] = await items(feed)
        expect(row.payoutMin).toBe(8_342_647)
        expect(row.payoutMax).toBe(9_847_353)
        expect(row.openPositions).toBe(2)
      })

      it('says nothing about pay when every seat is taken', async () => {
        await makePackage(12_035_294, 'assigned')

        const [row] = await items(feed)
        expect(row.payoutMin).toBeNull()
        expect(row.payoutMax).toBeNull()
        expect(row.openPositions).toBe(0)
      })

      it('still withholds the owner price and the platform margin', async () => {
        await makePackage(8_342_647, 'unassigned')

        const [row] = await items(feed)
        expect(row.finalPrice).toBeUndefined()
        expect(row.platformFee).toBeUndefined()
        expect(row.talentPayout).toBeUndefined()
      })

      it('drops the intake budget band it used to advertise', async () => {
        await makePackage(8_342_647, 'unassigned')

        const [row] = await items(feed)
        expect(row.budgetMin).toBeUndefined()
      })
    })
  }
})
