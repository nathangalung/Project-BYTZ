// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  disputes,
  getDb,
  milestones as milestonesTable,
  outboxEvents,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetServicePolicies } from '../lib/resilience'
import { advanceDisputePhase, isDisputeResolved } from './dispute.activities'
import { checkMilestoneReleased, notifyAutoRelease, releaseEscrow } from './milestone.activities'
import { escalateTeamFormation, finalizeTeam, getTeamStatus } from './team-formation.activities'

/**
 * The Temporal activity layer, which nothing else in the process calls.
 *
 * These functions are the bodies behind the auto-release timer, the dispute
 * escalation ladder and the 14 day team-formation deadline. Only the workflow
 * bundles import them, and workflows are excluded from this suite because they
 * run in the Temporal sandbox rather than vitest, so the activities were
 * reachable by nothing and executed by nothing.
 *
 * What is worth asserting is that every one of them is idempotent, because
 * Temporal's delivery guarantee is at-least-once and each of these will be
 * called twice sooner or later. Each activity is therefore driven to its guard:
 * a milestone that already moved past submitted, a dispute a human already
 * resolved, a project that is no longer staffing. The guards are the whole
 * point of the modules and they are all conditional, which is where the
 * branches are.
 *
 * releaseEscrow reaches the payment service, so fetch is stubbed, and the
 * failure case drives it to 500. resetServicePolicies in beforeEach is
 * insurance rather than a fix: the breakers in resilience.ts are module-level
 * Maps, so they are shared by every test in this file, and a ConsecutiveBreaker(5)
 * opens once five failures land with no success between them - after which the
 * next call returns "circuit open" instead of the upstream status the
 * assertion names. It does NOT leak into the next file: vitest's default
 * isolate gives each test file a fresh module registry, verified by running
 * two files that share a module-level counter and watching the second inherit
 * zero. Cheap to keep, and it stops the file growing into that failure.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

type ReleaseCall = { milestoneId: string; amount: number; feeAmount: number; performedBy: string }

runIf('temporal activities against Postgres', () => {
  let handle: TestHandle
  let releases: ReleaseCall[]
  let paymentStatus: number

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let projectId: string
  let packageId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    releases = []
    paymentStatus = 200
    // Circuits are module-level and shared across every file in this worker.
    resetServicePolicies()

    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('/payments/release')) {
        releases.push(JSON.parse(String(init?.body ?? '{}')) as ReleaseCall)
      }
      if (paymentStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'escrow unavailable' } }), {
          status: paymentStatus,
        })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    })

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Activity project',
      description: 'Drives the temporal activities',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 30,
      status: 'in_progress',
      finalPrice: 10_000_000,
      talentPayout: 7_150_000,
      platformFee: 2_850_000,
    })

    packageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: packageId,
      projectId,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 10_000_000,
      talentPayout: 7_150_000,
      status: 'in_progress',
    })
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

  async function makeMilestone(
    overrides: {
      status?: 'pending' | 'submitted' | 'approved'
      amount?: number
      assigned?: boolean
      withPackage?: boolean
    } = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestonesTable).values({
      id,
      projectId,
      workPackageId: overrides.withPackage === false ? null : packageId,
      assignedTalentId: overrides.assigned === false ? null : talentId,
      title: 'Milestone one',
      description: 'Deliverable',
      orderIndex: 0,
      amount: overrides.amount ?? 5_000_000,
      status: overrides.status ?? 'submitted',
      dueDate: new Date(Date.now() + 86_400_000),
    })
    return id
  }

  function eventTypes(): Promise<{ type: string }[]> {
    return handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
  }

  async function statusOf(milestoneId: string): Promise<string> {
    const [row] = await handle.db
      .select({ status: milestonesTable.status })
      .from(milestonesTable)
      .where(eq(milestonesTable.id, milestoneId))
    return row.status
  }

  describe('checkMilestoneReleased', () => {
    it('reports a submitted milestone as still awaiting release', async () => {
      const id = await makeMilestone({ status: 'submitted' })

      expect(await checkMilestoneReleased(id)).toEqual({
        alreadyReleased: false,
        status: 'submitted',
      })
    })

    it('reports a milestone the owner already approved as released', async () => {
      const id = await makeMilestone({ status: 'approved' })

      expect(await checkMilestoneReleased(id)).toEqual({
        alreadyReleased: true,
        status: 'approved',
      })
    })

    /**
     * A deleted milestone must read as released, not as pending forever. The
     * workflow polls this and would otherwise hold a timer on a row that is
     * never coming back.
     */
    it('treats a milestone that no longer exists as released', async () => {
      expect(await checkMilestoneReleased(uuidv7())).toEqual({
        alreadyReleased: true,
        status: null,
      })
    })
  })

  describe('releaseEscrow', () => {
    it('approves the milestone, pays the talent and records the approval event', async () => {
      const id = await makeMilestone({ status: 'submitted', amount: 5_000_000 })

      expect(await releaseEscrow(id)).toEqual({ released: true })

      expect(await statusOf(id)).toBe('approved')
      expect(await eventTypes()).toContainEqual({ type: 'milestone.approved' })
      expect(releases).toHaveLength(1)
      expect(releases[0].milestoneId).toBe(id)
      expect(releases[0].performedBy).toBe('system:auto_release')
      // 5,000,000 gross at the package ratio 7,150,000/10,000,000 leaves the
      // talent 3,575,000 and the platform the rest.
      expect(releases[0].amount).toBe(5_000_000)
      expect(releases[0].feeAmount).toBe(1_425_000)
    })

    /**
     * The bug this guards: the status flip and the payout were one step, so a
     * Temporal retry after a failed payment found the milestone already
     * approved, reported success and never paid. The payout must run on the
     * second attempt even though the flip does not.
     */
    it('still pays when a previous attempt already flipped the status', async () => {
      const id = await makeMilestone({ status: 'approved' })

      expect(await releaseEscrow(id)).toEqual({ released: false })

      expect(releases).toHaveLength(1)
      expect(releases[0].milestoneId).toBe(id)
    })

    it('does not emit a second approval event when the flip does not happen', async () => {
      const id = await makeMilestone({ status: 'approved' })

      await releaseEscrow(id)

      expect(await eventTypes()).not.toContainEqual({ type: 'milestone.approved' })
    })

    /**
     * Retries are what make the payout safe to call twice, so the second call
     * must not move money again. Idempotency is enforced by the payment
     * service on the milestone key; what is asserted here is that this side
     * sends the same request rather than a second distinct one.
     */
    it('sends an identical release on a repeat run', async () => {
      const id = await makeMilestone({ status: 'submitted' })

      await releaseEscrow(id)
      await releaseEscrow(id)

      expect(releases).toHaveLength(2)
      expect(releases[0]).toEqual(releases[1])
    })

    it('leaves the milestone approved but unpaid when it carries no talent', async () => {
      const id = await makeMilestone({ status: 'submitted', assigned: false })

      expect(await releaseEscrow(id)).toEqual({ released: true })

      expect(await statusOf(id)).toBe('approved')
      expect(releases).toHaveLength(0)
    })

    it('reports nothing released for a milestone that does not exist', async () => {
      expect(await releaseEscrow(uuidv7())).toEqual({ released: false })
      expect(releases).toHaveLength(0)
    })

    /**
     * Payment failure must propagate. Temporal retries a failed activity; an
     * activity that swallowed the error would report the milestone settled
     * while the talent was never paid.
     *
     * Timeout is explicit because releaseMilestoneEscrow opts into transient
     * retry: three attempts with a 1s then 2s backoff spend most of vitest's
     * 5000ms default before the assertion is reached.
     */
    it('propagates a payment service failure instead of reporting success', async () => {
      const id = await makeMilestone({ status: 'submitted' })
      paymentStatus = 500

      await expect(releaseEscrow(id)).rejects.toThrow(/payment-service call failed/)

      // The flip is committed before the payout is attempted, so the retry
      // finds it approved and takes the already-flipped path above.
      expect(await statusOf(id)).toBe('approved')
    }, 20_000)
  })

  describe('notifyAutoRelease', () => {
    it('names the talent user and the amount on the auto-release event', async () => {
      const id = await makeMilestone({ status: 'approved', amount: 5_000_000 })

      await notifyAutoRelease(id)

      const [event] = await handle.db
        .select({ type: outboxEvents.eventType, payload: outboxEvents.payload })
        .from(outboxEvents)
      expect(event.type).toBe('milestone.auto_released')
      // The join resolves talent_profiles.user_id: notifications.user_id
      // references user, so emitting the profile id would address nobody.
      expect(event.payload).toMatchObject({
        milestoneId: id,
        projectId,
        talentId: talentUserId,
        amount: 5_000_000,
        source: 'temporal',
      })
    })

    /**
     * The left join is what allows this. An inner join would emit no event at
     * all for an integration milestone, which carries no single talent.
     */
    it('still emits an event for a milestone with no assigned talent', async () => {
      const id = await makeMilestone({ status: 'approved', assigned: false })

      await notifyAutoRelease(id)

      const [event] = await handle.db.select({ payload: outboxEvents.payload }).from(outboxEvents)
      expect(event.payload).toMatchObject({ milestoneId: id, projectId, talentId: null })
    })

    it('emits a nulled event for a milestone that no longer exists', async () => {
      const missing = uuidv7()

      await notifyAutoRelease(missing)

      const [event] = await handle.db.select({ payload: outboxEvents.payload }).from(outboxEvents)
      expect(event.payload).toMatchObject({
        milestoneId: missing,
        projectId: null,
        talentId: null,
        amount: 0,
      })
    })
  })

  describe('advanceDisputePhase', () => {
    async function makeDispute(status: 'open' | 'resolved' = 'open'): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(disputes).values({
        id,
        projectId,
        initiatedBy: ownerId,
        againstUserId: talentUserId,
        reason: 'Deliverable does not match the PRD',
        status,
      })
      return id
    }

    async function disputeStatus(id: string): Promise<string> {
      const [row] = await handle.db
        .select({ status: disputes.status })
        .from(disputes)
        .where(eq(disputes.id, id))
      return row.status
    }

    /** The three rungs of the ladder in CLAUDE.md, each with its own event. */
    it.each([
      ['direct', 'under_review'],
      ['mediation', 'mediation'],
      ['binding', 'escalated'],
    ] as const)('moves a %s phase dispute to %s', async (phase, expected) => {
      const id = await makeDispute()

      await advanceDisputePhase(id, phase)

      expect(await disputeStatus(id)).toBe(expected)
      expect(await eventTypes()).toContainEqual({ type: `dispute.phase.${phase}` })
    })

    /**
     * The escalation timer keeps firing after an admin settles the dispute.
     * Reopening a resolved dispute would unfreeze escrow that a binding
     * decision already disposed of.
     */
    it('refuses to reopen a dispute an admin already resolved', async () => {
      const id = await makeDispute('resolved')

      await advanceDisputePhase(id, 'binding')

      expect(await disputeStatus(id)).toBe('resolved')
      expect(await eventTypes()).toEqual([])
    })

    it('does nothing for a dispute that does not exist', async () => {
      await advanceDisputePhase(uuidv7(), 'direct')

      expect(await eventTypes()).toEqual([])
    })
  })

  describe('isDisputeResolved', () => {
    it('is false while the dispute is open and true once it is resolved', async () => {
      const id = uuidv7()
      await handle.db.insert(disputes).values({
        id,
        projectId,
        initiatedBy: ownerId,
        againstUserId: talentUserId,
        reason: 'Late delivery',
        status: 'open',
      })
      expect(await isDisputeResolved(id)).toBe(false)

      await handle.db.update(disputes).set({ status: 'resolved' }).where(eq(disputes.id, id))
      expect(await isDisputeResolved(id)).toBe(true)
    })

    it('is false for a dispute that does not exist', async () => {
      expect(await isDisputeResolved(uuidv7())).toBe(false)
    })
  })

  describe('getTeamStatus', () => {
    async function addPackage(status: string, title = 'Extra'): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(workPackages).values({
        id,
        projectId,
        title,
        description: 'Package',
        orderIndex: 1,
        requiredSkills: ['frontend'],
        estimatedHours: 20,
        amount: 4_000_000,
        talentPayout: 2_860_000,
        status: status as 'unassigned',
      })
      return id
    }

    /**
     * Three buckets, and which status lands in which is the whole function.
     * in_progress and completed count as staffed alongside assigned, because
     * the question the workflow asks is whether anyone still needs finding.
     */
    it('counts assigned, pending and unassigned packages separately', async () => {
      await addPackage('pending_acceptance', 'Frontend')
      await addPackage('unassigned', 'Design')
      await addPackage('completed', 'Data')

      // The fixture package is already in_progress, which counts as assigned.
      expect(await getTeamStatus(projectId)).toEqual({
        totalPackages: 4,
        assigned: 2,
        pending: 1,
        unassigned: 1,
        isComplete: false,
      })
    })

    it('is complete only when every package is staffed', async () => {
      await addPackage('assigned', 'Frontend')

      expect(await getTeamStatus(projectId)).toMatchObject({ assigned: 2, isComplete: true })
    })

    it('counts a declined package as still needing a talent', async () => {
      await addPackage('declined', 'Frontend')

      expect(await getTeamStatus(projectId)).toMatchObject({ unassigned: 1, isComplete: false })
    })

    /**
     * A project with no packages is not a complete team. Reading zero of zero
     * as done would promote an unstaffed project to MATCHED.
     */
    it('is not complete for a project with no work packages', async () => {
      const empty = uuidv7()
      await handle.db.insert(projects).values({
        id: empty,
        ownerId,
        title: 'No packages',
        description: 'Nothing decomposed yet',
        category: 'web_app',
        budgetMin: 1_000_000,
        budgetMax: 2_000_000,
        estimatedTimelineDays: 10,
        status: 'matching',
      })

      expect(await getTeamStatus(empty)).toEqual({
        totalPackages: 0,
        assigned: 0,
        pending: 0,
        unassigned: 0,
        isComplete: false,
      })
    })
  })

  describe('finalizeTeam', () => {
    async function setStatus(status: string): Promise<void> {
      await handle.db
        .update(projects)
        .set({ status: status as 'matching' })
        .where(eq(projects.id, projectId))
    }

    it.each(['matching', 'team_forming'] as const)(
      'promotes a %s project to matched and announces it',
      async (from) => {
        await setStatus(from)

        expect(await finalizeTeam(projectId)).toEqual({ updated: true })

        const [row] = await handle.db
          .select({ status: projects.status })
          .from(projects)
          .where(eq(projects.id, projectId))
        expect(row.status).toBe('matched')
        expect(await eventTypes()).toContainEqual({ type: 'project.team.complete' })
      },
    )

    /**
     * The guard that matters. The workflow can finalise late, and a project
     * that has moved on to in_progress must not be dragged back to matched.
     */
    it('refuses to move a project that already left staffing', async () => {
      await setStatus('in_progress')

      expect(await finalizeTeam(projectId)).toEqual({ updated: false })

      const [row] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(row.status).toBe('in_progress')
      expect(await eventTypes()).toEqual([])
    })

    it('is idempotent: a second run neither moves the project nor re-announces', async () => {
      await setStatus('team_forming')
      await finalizeTeam(projectId)

      expect(await finalizeTeam(projectId)).toEqual({ updated: false })

      expect(await eventTypes()).toEqual([{ type: 'project.team.complete' }])
    })

    it('reports nothing updated for a project that does not exist', async () => {
      expect(await finalizeTeam(uuidv7())).toEqual({ updated: false })
      expect(await eventTypes()).toEqual([])
    })
  })

  describe('escalateTeamFormation', () => {
    it('carries the reason onto the escalation event', async () => {
      await escalateTeamFormation(projectId, 'deadline_reached')

      const [event] = await handle.db
        .select({ type: outboxEvents.eventType, payload: outboxEvents.payload })
        .from(outboxEvents)
      expect(event.type).toBe('project.team.escalated')
      expect(event.payload).toMatchObject({
        projectId,
        reason: 'deadline_reached',
        source: 'temporal',
      })
    })
  })

  /**
   * Not a behaviour of any one activity: an assignment row is what a staffed
   * package means elsewhere, so this pins that getTeamStatus reads package
   * status rather than assignment rows, which is what the workflow relies on
   * when a talent is mid-acceptance.
   */
  it('counts a package as pending while its assignment is unaccepted', async () => {
    await handle.db
      .update(workPackages)
      .set({ status: 'pending_acceptance' })
      .where(eq(workPackages.id, packageId))
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: packageId,
      acceptanceStatus: 'pending',
      status: 'active',
    })

    expect(await getTeamStatus(projectId)).toMatchObject({ pending: 1, isComplete: false })
  })
})
