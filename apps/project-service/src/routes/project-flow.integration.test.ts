// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import {
  chatConversations,
  chatParticipants,
  contracts,
  getDb,
  milestones as milestonesTable,
  projectAssignments,
  projects as projectsTable,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseEscrow } from '../activities/milestone.activities'
import { resetServicePolicies } from '../lib/resilience'
import { settleMilestoneEscrow } from '../lib/settle-milestone'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { MilestoneRepository } from '../repositories/milestone.repository'
import { AutoReleaseSweepService } from '../services/auto-release-sweep'
import { matchingRoute } from './matching'
import { milestonesRoute } from './milestones'
import { projectsRoute } from './projects'

/**
 * One project walked end to end with two talents on it.
 *
 * The per-route suites each prove their own rule; none of them proves the rules
 * compose. This walks the order a real project takes -- staffing, acceptance,
 * agreements, work, rejection, approval, payout -- and asserts the gates fire
 * in that order rather than in isolation.
 *
 * Where it stops, and why: the flow ends at "the ledger says the talent is
 * owed", not "the talent has the money". Escrow release writes ledger rows and
 * calls payment-service; the disbursement that would move cash needs Midtrans
 * Payouts, which requires an approval the platform cannot obtain on sandbox. A
 * test named for the talent being paid would be asserting bookkeeping and
 * claiming banking.
 *
 * payment-service is stubbed at fetch, as the milestone and dispute suites do.
 * Everything on this side of that boundary is real: real Postgres, real route
 * handlers, real state machine.
 */

vi.mock('../lib/temporal-client', () => ({
  getTemporalClient: async () => null,
  TEMPORAL_TASK_QUEUE: 'test',
  milestoneAutoReleaseWorkflowId: (id: string) => `auto-release-${id}`,
  disputeResolutionWorkflowId: (id: string) => `dispute-${id}`,
  teamFormationWorkflowId: (id: string) => `team-formation-${id}`,
}))

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260909)`

const PACKAGE_AMOUNT = 5_000_000
/** Project total is 10jt, which sits in the <= Rp 10 juta bracket: 71,5%. */
const PACKAGE_PAYOUT = 3_575_000

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  // Mounted the way index.ts does: milestonesRoute carries its own prefix.
  app.route('/projects', projectsRoute)
  app.route('/matching', matchingRoute)
  app.route('/', milestonesRoute)
  return app
}

function json(caller: SessionUser, path: string, method: string, body?: unknown) {
  return appAs(caller).request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type ReleaseCall = {
  projectId?: string
  milestoneId?: string
  amount?: number
  feeAmount?: number
  idempotencyKey?: string
}

runIf('the money and project flow, end to end', () => {
  let handle: TestHandle
  let releases: ReleaseCall[]

  let ownerId: string
  let talentUserA: string
  let talentUserB: string
  let talentA: string
  let talentB: string
  let projectId: string
  let packageA: string
  let packageB: string
  let milestoneA: string
  let milestoneB: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function makeTalent(userId: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(talentProfiles).values({
      id,
      userId,
      verificationStatus: 'verified',
      availabilityStatus: 'available',
      payoutChannel: 'bank',
      payoutProvider: 'bca',
      payoutAccountNumber: '1234567890',
      payoutAccountHolderName: 'Talent Name',
    })
    return id
  }

  async function makePackage(title: string, order: number): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(workPackages).values({
      id,
      projectId,
      title,
      description: title,
      orderIndex: order,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: PACKAGE_AMOUNT,
      talentPayout: PACKAGE_PAYOUT,
      status: 'unassigned',
    })
    return id
  }

  async function makeMilestone(packageId: string, talentId: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestonesTable).values({
      id,
      projectId,
      workPackageId: packageId,
      assignedTalentId: talentId,
      title: 'Deliver the package',
      description: 'Single milestone covering the package',
      milestoneType: 'individual',
      orderIndex: 0,
      amount: PACKAGE_AMOUNT,
      status: 'pending',
      dueDate: new Date(Date.now() + 14 * 86_400_000),
    })
    return id
  }

  async function statusOf(): Promise<string | undefined> {
    const [row] = await handle.db
      .select({ status: projectsTable.status })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
    return row?.status
  }

  async function milestoneStatus(id: string): Promise<string | undefined> {
    const [row] = await handle.db
      .select({ status: milestonesTable.status })
      .from(milestonesTable)
      .where(eq(milestonesTable.id, id))
    return row?.status
  }

  beforeEach(async () => {
    await handle.truncate()
    resetServicePolicies()
    releases = []

    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('/payments/internal/release')) {
        releases.push(JSON.parse(String(init?.body ?? '{}')) as ReleaseCall)
        return new Response(JSON.stringify({ success: true, data: { released: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (href.includes('/payments/internal/escrow-balance')) {
        return new Response(JSON.stringify({ success: true, data: { balance: 10_000_000 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    ownerId = await makeUser('owner')
    talentUserA = await makeUser('talent-a')
    talentUserB = await makeUser('talent-b')
    talentA = await makeTalent(talentUserA)
    talentB = await makeTalent(talentUserB)

    projectId = uuidv7()
    await handle.db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      title: 'Two-talent project',
      description: 'Walks the whole flow',
      category: 'web_app',
      budgetMin: 8_000_000,
      budgetMax: 12_000_000,
      estimatedTimelineDays: 60,
      status: 'team_forming',
      teamSize: 2,
      finalPrice: 2 * PACKAGE_AMOUNT,
      talentPayout: 2 * PACKAGE_PAYOUT,
      platformFee: 2 * PACKAGE_AMOUNT - 2 * PACKAGE_PAYOUT,
    })
    packageA = await makePackage('Backend API', 0)
    packageB = await makePackage('Frontend', 1)
    milestoneA = await makeMilestone(packageA, talentA)
    milestoneB = await makeMilestone(packageB, talentB)
  })

  async function staffBoth(): Promise<{ a: string; b: string }> {
    await json(session(ownerId, 'owner'), '/matching/confirm', 'POST', {
      projectId,
      assignments: [
        { workPackageId: packageA, talentId: talentA },
        { workPackageId: packageB, talentId: talentB },
      ],
    })
    const rows = await handle.db
      .select({ id: projectAssignments.id, talentId: projectAssignments.talentId })
      .from(projectAssignments)
    return {
      a: rows.find((r) => r.talentId === talentA)?.id as string,
      b: rows.find((r) => r.talentId === talentB)?.id as string,
    }
  }

  async function signAll(): Promise<void> {
    await handle.db
      .update(contracts)
      .set({ signedByOwner: true, signedByTalent: true, signedAt: new Date() })
      .where(eq(contracts.projectId, projectId))
  }

  /** Staffing, both acceptances, agreements, and the start of work. */
  async function reachInProgress(): Promise<{ a: string; b: string }> {
    const ids = await staffBoth()
    await json(session(talentUserA), `/matching/assignments/${ids.a}/accept`, 'POST')
    await json(session(talentUserB), `/matching/assignments/${ids.b}/accept`, 'POST')
    await signAll()
    await json(session(ownerId, 'owner'), `/projects/${projectId}/transition`, 'POST', {
      status: 'in_progress',
    })
    return ids
  }

  it('reaches matched only when both talents have accepted', async () => {
    const ids = await staffBoth()

    await json(session(talentUserA), `/matching/assignments/${ids.a}/accept`, 'POST')
    expect(await statusOf()).toBe('team_forming')

    await json(session(talentUserB), `/matching/assignments/${ids.b}/accept`, 'POST')
    expect(await statusOf()).toBe('matched')
  })

  it('writes an NDA and an IP transfer for each talent when the team completes', async () => {
    await staffBoth().then(async (ids) => {
      await json(session(talentUserA), `/matching/assignments/${ids.a}/accept`, 'POST')
      await json(session(talentUserB), `/matching/assignments/${ids.b}/accept`, 'POST')
    })

    const rows = await handle.db
      .select({ type: contracts.type, assignmentId: contracts.assignmentId })
      .from(contracts)
      .where(eq(contracts.projectId, projectId))

    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((r) => r.assignmentId)).size).toBe(2)
  })

  it('opens a private thread per talent and one group thread when the team completes', async () => {
    await staffBoth().then(async (ids) => {
      await json(session(talentUserA), `/matching/assignments/${ids.a}/accept`, 'POST')
      await json(session(talentUserB), `/matching/assignments/${ids.b}/accept`, 'POST')
    })

    const threads = await handle.db
      .select({ id: chatConversations.id, type: chatConversations.type })
      .from(chatConversations)
      .where(eq(chatConversations.projectId, projectId))

    const priv = threads.filter((t) => t.type === 'owner_talent')
    const group = threads.filter((t) => t.type === 'team_group')
    expect(priv).toHaveLength(2)
    expect(group).toHaveLength(1)

    // A thread nobody participates in is unreadable by everybody, so the
    // membership is the half worth asserting.
    const members = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, group[0]?.id ?? ''))
    expect(new Set(members.map((m) => m.userId))).toEqual(
      new Set([ownerId, talentUserA, talentUserB]),
    )
  })

  it('refuses to start work until every agreement is signed', async () => {
    const ids = await staffBoth()
    await json(session(talentUserA), `/matching/assignments/${ids.a}/accept`, 'POST')
    await json(session(talentUserB), `/matching/assignments/${ids.b}/accept`, 'POST')

    const blocked = await json(
      session(ownerId, 'owner'),
      `/projects/${projectId}/transition`,
      'POST',
      { status: 'in_progress' },
    )

    expect(blocked.status).toBe(422)
    expect(((await blocked.json()) as ErrorBody).error.code).toBe('CONTRACT_NOT_SIGNED')
    expect(await statusOf()).toBe('matched')

    await signAll()
    const allowed = await json(
      session(ownerId, 'owner'),
      `/projects/${projectId}/transition`,
      'POST',
      { status: 'in_progress' },
    )

    expect(allowed.status).toBe(200)
    expect(await statusOf()).toBe('in_progress')
  })

  it('walks submit, reject, resume, resubmit and approve', async () => {
    await reachInProgress()

    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })
    expect(await milestoneStatus(milestoneA)).toBe('submitted')

    // Rejected is not a dead end: it spends a round and goes back to work.
    await json(session(ownerId, 'owner'), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'rejected',
      reason: 'Does not match the PRD',
    })
    expect(await milestoneStatus(milestoneA)).toBe('rejected')

    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })
    const approved = await json(
      session(ownerId, 'owner'),
      `/milestones/${milestoneA}/status`,
      'PATCH',
      { status: 'approved' },
    )

    expect(approved.status).toBe(200)
    expect(await milestoneStatus(milestoneA)).toBe('approved')
  })

  /**
   * The split the owner pays and the talent receives, asserted where it is
   * actually decided. Owner pays gross; escrow holds gross; the fee is
   * separated only at release.
   */
  it('splits the milestone into talent payout and platform fee at release', async () => {
    await reachInProgress()
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })

    await json(session(ownerId, 'owner'), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'approved',
    })

    expect(releases).toHaveLength(1)
    const [call] = releases
    // The request carries the gross the owner paid plus the platform's cut;
    // payment-service books the talent's share as the difference. So the split
    // is asserted as an identity, not as two numbers that happen to be right.
    expect(call?.amount).toBe(PACKAGE_AMOUNT)
    expect(call?.feeAmount).toBe(PACKAGE_AMOUNT - PACKAGE_PAYOUT)
    expect((call?.amount ?? 0) - (call?.feeAmount ?? 0)).toBe(PACKAGE_PAYOUT)
  })

  /** One talent's approval must not touch the other's package. */
  it('keeps the two talent milestones independent', async () => {
    await reachInProgress()
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })

    await json(session(ownerId, 'owner'), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'approved',
    })

    expect(await milestoneStatus(milestoneB)).toBe('pending')
    expect(releases).toHaveLength(1)
    expect(await statusOf()).toBe('in_progress')
  })

  it('refuses a talent approving their own milestone', async () => {
    await reachInProgress()
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })

    const res = await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'approved',
    })

    expect(res.status).toBe(403)
    expect(releases).toHaveLength(0)
  })

  it('refuses one talent touching the other talent milestone', async () => {
    await reachInProgress()

    const res = await json(session(talentUserB), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })

    expect(res.status).toBe(403)
  })

  /**
   * Every milestone approved moves the project to review, which is where the
   * owner accepts and the project completes.
   */
  it('moves to review once both talents are done', async () => {
    await reachInProgress()
    for (const [talentUser, milestoneId] of [
      [talentUserA, milestoneA],
      [talentUserB, milestoneB],
    ] as const) {
      await json(session(talentUser), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'in_progress',
      })
      await json(session(talentUser), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'submitted',
      })
      await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'approved',
      })
    }

    expect(releases).toHaveLength(2)
    expect(await statusOf()).toBe('review')
  })

  /**
   * The owner who never answers. Approval is not the only way a milestone
   * settles: after AUTO_RELEASE_DAYS the sweep pays the talent anyway, which is
   * what stops an owner from holding finished work hostage by doing nothing.
   *
   * Driven through the real repository query and the real settle path, so the
   * cutoff and the compare-and-swap on 'submitted' are the ones production
   * uses. Only the clock is faked.
   */
  it('pays the talent when the owner never answers', async () => {
    await reachInProgress()
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })

    // Submitted fifteen days ago; the window is fourteen.
    await handle.db
      .update(milestonesTable)
      .set({ submittedAt: new Date(Date.now() - 15 * 86_400_000) })
      .where(eq(milestonesTable.id, milestoneA))

    const db = getDb(process.env.TEST_DATABASE_URL)
    // Wired as scheduled-jobs.ts wires it: settle pays, releaseEscrow commits
    // the approval. Stubbing the second is what left the row in 'submitted'.
    const sweep = new AutoReleaseSweepService(
      new MilestoneRepository(db),
      settleMilestoneEscrow,
      releaseEscrow,
      async () => {},
    )

    const result = await sweep.sweep()

    expect(result.settled).toBe(1)
    expect(await milestoneStatus(milestoneA)).toBe('approved')

    // Both the settle and the release reach payment-service, which is by
    // design: they share one idempotency key and payment-service is what
    // collapses them. Asserting a single call here would be asserting the stub.
    expect(releases.length).toBeGreaterThan(0)
    expect(new Set(releases.map((r) => r.idempotencyKey))).toEqual(
      new Set([`release:${milestoneA}`]),
    )
    for (const call of releases) {
      expect((call.amount ?? 0) - (call.feeAmount ?? 0)).toBe(PACKAGE_PAYOUT)
    }
  })

  /** A milestone still inside the window is left alone. */
  it('leaves a recently submitted milestone for the owner to review', async () => {
    await reachInProgress()
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'in_progress',
    })
    await json(session(talentUserA), `/milestones/${milestoneA}/status`, 'PATCH', {
      status: 'submitted',
    })

    const db = getDb(process.env.TEST_DATABASE_URL)
    const sweep = new AutoReleaseSweepService(
      new MilestoneRepository(db),
      async () => ({ paid: true }),
      async () => ({ released: true }),
      async () => {},
    )

    const result = await sweep.sweep()

    expect(result.settled).toBe(0)
    expect(await milestoneStatus(milestoneA)).toBe('submitted')
    expect(releases).toHaveLength(0)
  })

  /**
   * A talent cannot accept work with nowhere to be paid. Checked here rather
   * than only in the matching suite because it is the first gate of the flow
   * and the one that decides whether the last one can ever settle.
   */
  it('refuses acceptance from a talent with no payout destination', async () => {
    const ids = await staffBoth()
    await handle.db
      .update(talentProfiles)
      .set({ payoutAccountNumber: null })
      .where(eq(talentProfiles.id, talentA))

    const res = await json(session(talentUserA), `/matching/assignments/${ids.a}/accept`, 'POST')

    expect(res.status).toBe(422)
    expect(((await res.json()) as ErrorBody).error.code).toBe('TALENT_PAYOUT_ACCOUNT_REQUIRED')
    expect(await statusOf()).toBe('team_forming')
  })

  it('reopens the package when a talent declines, leaving the other staffed', async () => {
    const ids = await staffBoth()

    await json(session(talentUserA), `/matching/assignments/${ids.a}/decline`, 'POST')

    const [pkgA] = await handle.db
      .select({ status: workPackages.status })
      .from(workPackages)
      .where(eq(workPackages.id, packageA))
    const [pkgB] = await handle.db
      .select({ status: workPackages.status })
      .from(workPackages)
      .where(eq(workPackages.id, packageB))
    expect(pkgA?.status).toBe('unassigned')
    expect(pkgB?.status).toBe('pending_acceptance')
    expect(await statusOf()).toBe('team_forming')
  })

  it('leaves the assignments live and signed after work starts', async () => {
    const ids = await reachInProgress()

    const live = await handle.db
      .select({ id: projectAssignments.id })
      .from(projectAssignments)
      .where(
        and(
          eq(projectAssignments.projectId, projectId),
          eq(projectAssignments.acceptanceStatus, 'accepted'),
        ),
      )
    expect(live.map((r) => r.id).sort()).toEqual([ids.a, ids.b].sort())
  })
})
