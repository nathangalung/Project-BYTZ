import {
  type Database,
  getDb,
  projectAssignments,
  projects,
  talentProfiles,
  workPackageDependencies,
  workPackages,
} from '@kerjacus/db'
import { TALENT_SUBJECTS } from '@kerjacus/nats-events'
import { AppError } from '@kerjacus/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { env } from '../lib/env'
import { appendOutboxEvent } from '../lib/outbox'
import { assertProjectOwner } from '../lib/project-access'
import { finalizeStaffing } from '../lib/staffing-completion'
import { assertAssignmentPending, validateTeamAssignments } from '../lib/team-assignment'
import { signalTeamComplete, startTeamFormationWorkflow } from '../lib/team-formation-workflow'
import { groupPrerequisiteTitles } from '../lib/work-package-planning'
import { getAuthUser } from '../middleware/session'
import { MatchingRepository } from '../repositories/matching.repository'
import { MatchingService } from '../services/matching.service'

function hasServiceAuth(c: Context): boolean {
  const header = c.req.header('X-Service-Auth')
  return Boolean(env.SERVICE_AUTH_SECRET) && header === env.SERVICE_AUTH_SECRET
}

const recommendSchema = z.object({
  // Empty is allowed: with no skill target, ranking falls to fairness, track
  // record and rating, and every candidate is admitted. The skill component
  // scores 0 for everyone rather than a fabricated half-match -- see
  // computeSkillMatch and the admission predicate in scorePool.
  requiredSkills: z.array(z.string()),
  excludeTalentIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
})

const confirmSchema = z.object({
  projectId: z.string().min(1),
  // One talent per work package. The owner staffs each open position; the
  // team is complete only once every package is covered.
  assignments: z
    .array(z.object({ workPackageId: z.string().min(1), talentId: z.string().min(1) }))
    .min(1),
})

function getService(): MatchingService {
  const db = getDb()
  const repo = new MatchingRepository(db)
  return new MatchingService(repo)
}

/**
 * Positions in which a seat may be staffed.
 *
 * /confirm checked ownership, open packages and the talent's CV, but never
 * that the project was somewhere hiring is legal - so an owner could POST it
 * against a project in final review and create pending offers on any package
 * that happened to read `unassigned`. These two are where an open seat is a
 * seat the project is actually trying to fill: `matching` before work starts,
 * whether or not offers are already out, and `in_progress` for a running
 * project that lost a talent. A project with no open package is refused by
 * validateTeamAssignments, which is the check that used to be spread across
 * the extra statuses.
 */
const STAFFABLE_PROJECT_STATUSES = new Set<string>(['matching', 'in_progress'])

function assertProjectStaffable(status: string): void {
  if (!STAFFABLE_PROJECT_STATUSES.has(status)) {
    throw new AppError(
      'CONFLICT',
      `A position can only be staffed while the project is matching or running with an open seat, not in '${status}'`,
    )
  }
}

export const matchingRoute = new Hono()

// POST /recommend - raw scored recommendations for other services (ai-service).
// Service-auth only: the payload carries userId and the internal rating and
// fairness signals, which the anonymity rule keeps away from owners and
// talents. User-facing staffing goes through /:projectId/positions, which
// strips those fields.
matchingRoute.post('/recommend', async (c) => {
  if (!hasServiceAuth(c)) {
    throw new AppError('AUTH_FORBIDDEN', 'Service credentials required')
  }
  const body = await c.req.json()

  const parsed = recommendSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid matching parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const service = getService()
  const result = await service.matchTalentsToProject(
    parsed.data.requiredSkills,
    parsed.data.excludeTalentIds ?? [],
    parsed.data.limit ?? 10,
  )

  if (result.recommendations.length === 0) {
    throw new AppError(
      'MATCHING_NO_TALENTS_FOUND',
      'No eligible talents found for the requested skills',
    )
  }

  return c.json({
    success: true,
    data: result,
  })
})

/**
 * Titles of the packages each open position waits on.
 *
 * The PRD's dependency graph decides which role is on the critical path, so the
 * owner staffs the blocker before the work that cannot start without it. An
 * empty graph yields empty lists and the page simply shows no ordering.
 */
async function prerequisiteTitles(
  projectId: string,
  open: readonly { id: string }[],
): Promise<Map<string, string[]>> {
  if (open.length === 0) return new Map()

  const db = getDb()
  const all = await db
    .select({ id: workPackages.id, title: workPackages.title })
    .from(workPackages)
    .where(eq(workPackages.projectId, projectId))

  const edges = await db
    .select({
      workPackageId: workPackageDependencies.workPackageId,
      dependsOnWorkPackageId: workPackageDependencies.dependsOnWorkPackageId,
    })
    .from(workPackageDependencies)
    .where(
      inArray(
        workPackageDependencies.workPackageId,
        open.map((w) => w.id),
      ),
    )

  return groupPrerequisiteTitles(edges, new Map(all.map((w) => [w.id, w.title])))
}

// GET /:projectId/positions - per-work-package recommendations for the owner to
// staff a team. Each unassigned package carries its own ranked candidates scored
// against that package's skills, so the owner picks one talent per position.
matchingRoute.get('/:projectId/positions', async (c) => {
  const projectId = c.req.param('projectId')
  if (!hasServiceAuth(c)) {
    const user = getAuthUser(c)
    await assertProjectOwner(projectId, user.id)
  }

  const db = getDb()
  const wps = await db
    .select({
      id: workPackages.id,
      title: workPackages.title,
      requiredSkills: workPackages.requiredSkills,
      orderIndex: workPackages.orderIndex,
    })
    .from(workPackages)
    .where(and(eq(workPackages.projectId, projectId), inArray(workPackages.status, ['unassigned'])))
    .orderBy(asc(workPackages.orderIndex))

  const service = getService()
  const recs = await service.recommendForPackages(
    wps.map((w) => ({ workPackageId: w.id, requiredSkills: (w.requiredSkills as string[]) ?? [] })),
  )
  const recsByPackage = new Map(recs.map((r) => [r.workPackageId, r.recommendations]))
  const prerequisites = await prerequisiteTitles(projectId, wps)

  // Only what the owner may see: userId and the internal signals (rating,
  // pemerataan, track record) stay server-side per the anonymity rule.
  const positions = wps.map((w) => ({
    workPackageId: w.id,
    title: w.title,
    requiredSkills: (w.requiredSkills as string[]) ?? [],
    dependsOn: prerequisites.get(w.id) ?? [],
    recommendations: (recsByPackage.get(w.id) ?? []).map((r) => ({
      talentId: r.talentId,
      score: r.score,
      skillMatch: r.skillMatch,
      isExploration: r.isExploration,
    })),
  }))

  return c.json({ success: true, data: { positions } })
})

// GET /my-offers - the signed-in talent's pending work-package offers to answer.
matchingRoute.get('/my-offers', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()
  const offers = await db
    .select({
      assignmentId: projectAssignments.id,
      projectId: projectAssignments.projectId,
      projectTitle: projects.title,
      workPackageId: workPackages.id,
      workPackageTitle: workPackages.title,
      payout: workPackages.talentPayout,
    })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .innerJoin(projects, eq(projects.id, projectAssignments.projectId))
    .innerJoin(workPackages, eq(workPackages.id, projectAssignments.workPackageId))
    .where(
      and(
        eq(talentProfiles.userId, user.id),
        eq(projectAssignments.acceptanceStatus, 'pending'),
        eq(projectAssignments.status, 'active'),
      ),
    )

  return c.json({ success: true, data: offers })
})

// POST /confirm - owner staffs each position; offers go out and the project
// stays in matching until every talent accepts and work starts.
matchingRoute.post('/confirm', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()

  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid confirm parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { projectId, assignments } = parsed.data

  // Only the owner picks the team.
  await assertProjectOwner(projectId, user.id)

  const db = getDb()

  // Team size decides whether the escalation timer applies at all; the first
  // round is worked out from the assignments below.
  const [proj] = await db
    .select({ status: projects.status, teamSize: projects.teamSize })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  // assertProjectOwner has already refused a project that is not there; this
  // narrows the optional read so the status below is read without a fallback
  // that would stand in for a row nobody can reach.
  if (!proj) throw new AppError('NOT_FOUND', 'Project not found')

  // Cheap refusal on what the read above saw. The transaction re-reads nothing,
  // so an owner racing their own status change can still slip one confirm
  // through; the point of this gate is the in_progress or review project an
  // owner can reach today with a single POST, not a two-request race.
  assertProjectStaffable(proj.status)

  // Open positions still to staff, and talents already on the team.
  const openWps = await db
    .select({ id: workPackages.id })
    .from(workPackages)
    .where(and(eq(workPackages.projectId, projectId), inArray(workPackages.status, ['unassigned'])))

  if (openWps.length === 0) {
    throw new AppError('MATCHING_NO_WORK_PACKAGES', 'No unassigned work packages found')
  }

  const existing = await db
    .select({ talentId: projectAssignments.talentId })
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        inArray(projectAssignments.status, ['active', 'completed']),
      ),
    )

  const openIds = new Set(openWps.map((w) => w.id))
  validateTeamAssignments(openIds, new Set(existing.map((e) => e.talentId)), assignments)

  // A CV is what the platform sells, and confirm is owner-driven: the talentIds
  // come from the request body, not the recommendation query, so an owner can
  // name any id. /recommend only returns verified talents, but nothing forces
  // the confirmed set to be that set -- so an unverified talent, one with no
  // parsed CV, could be staffed here around the vetting applications.ts enforces
  // on the self-service path. Same gate, same reason. Verification only, not
  // availability: verification is the platform's judgement about a person;
  // availability is the talent's own calendar flag, and re-staffing someone who
  // went busy is legitimate.
  const talentIds = [...new Set(assignments.map((a) => a.talentId))]
  const staffed = await db
    .select({
      id: talentProfiles.id,
      cvFileUrl: talentProfiles.cvFileUrl,
      verificationStatus: talentProfiles.verificationStatus,
    })
    .from(talentProfiles)
    .where(inArray(talentProfiles.id, talentIds))
  const staffedById = new Map(staffed.map((t) => [t.id, t]))
  for (const talentId of talentIds) {
    const t = staffedById.get(talentId)
    if (!t) {
      throw new AppError('NOT_FOUND', `Talent ${talentId} not found`)
    }
    if (!t.cvFileUrl) {
      throw new AppError('TALENT_CV_REQUIRED', `Talent ${talentId} has no CV on file`)
    }
    if (t.verificationStatus !== 'verified') {
      throw new AppError(
        'TALENT_NOT_VERIFIED',
        t.verificationStatus === 'suspended'
          ? `Talent ${talentId} is suspended`
          : `Talent ${talentId} is not verified yet`,
      )
    }
  }

  /**
   * Offers being out is not a position.
   *
   * This used to move the project to `team_forming`, which cost more than it
   * said: a project looking for a team dropped out of every feed keyed on
   * `matching` exactly while it most needed candidates, and the last decline
   * had to drag it back. It stays at `matching` until work starts. Whether
   * offers are out is read from the assignments, which is where it was all
   * along.
   */
  const firstRound = existing.length === 0

  await db.transaction(async (tx) => {
    // Project row before the work package rows, matching accept and decline.
    // This transaction already locks the project, but at the end, on the status
    // update -- so it held a work package while waiting for a row those two
    // hold while waiting for that package. Taking it up front removes the
    // inversion; it does not make the checks above atomic, which stay outside.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')

    for (const { talentId, workPackageId } of assignments) {
      await tx.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId,
        acceptanceStatus: 'pending',
        status: 'active',
      })
      await tx
        .update(workPackages)
        .set({ status: 'pending_acceptance' })
        .where(eq(workPackages.id, workPackageId))
    }

    await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId))

    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: 'project.team.forming',
      payload: { projectId, assignments, source: 'client_confirm' },
    })
  })

  // Start the 14-day escalation timer on the first round of offers, and only
  // for a real team; single-worker never needs it. Restaffing a declined
  // position is a later round and must not restart the clock - the status told
  // the two apart when there was a status for it, and the assignments do now.
  if (firstRound && (proj.teamSize ?? 1) > 1) {
    void startTeamFormationWorkflow(projectId).catch((err) => {
      console.warn('[temporal] team formation start failed', { projectId, err })
    })
  }

  return c.json({ success: true, data: { projectId, offered: assignments.length } })
})

// Talent accepts or declines the offer for their work package. Accepting staffs
// the package and, once every package is accepted, promotes the project to
// matched. Declining reopens the package so the owner can staff it again.
async function loadOwnAssignment(
  db: ReturnType<typeof getDb>,
  assignmentId: string,
  userId: string,
) {
  const [row] = await db
    .select({
      id: projectAssignments.id,
      projectId: projectAssignments.projectId,
      workPackageId: projectAssignments.workPackageId,
      acceptanceStatus: projectAssignments.acceptanceStatus,
      status: projectAssignments.status,
      payoutAccountNumber: talentProfiles.payoutAccountNumber,
    })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(and(eq(projectAssignments.id, assignmentId), eq(talentProfiles.userId, userId)))
    .limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Assignment not found')
  return row
}

/**
 * Refuse to take on work with nowhere to be paid.
 *
 * Accepting is where the talent commits, and it is the last point at which
 * refusing costs them nothing. Without this they can accept, work every
 * milestone and reach release before anyone notices there is no destination,
 * and by then the money is owed and stuck. Deliberately not asked at
 * registration: browsing the platform should not require handing over an
 * account number.
 *
 * Presence only. Verification is the gateway's answer and arrives later, so
 * gating acceptance on it would block every talent behind a check they cannot
 * run themselves.
 */
function assertPayoutDestination(assignment: { payoutAccountNumber: string | null }): void {
  if (!assignment.payoutAccountNumber) {
    throw new AppError(
      'TALENT_PAYOUT_ACCOUNT_REQUIRED',
      'Add a payout account (bank or e-wallet) before accepting a project',
    )
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Claim a pending offer by moving it off `pending`, or lose the race.
 *
 * loadOwnAssignment reads on the pool and assertAssignmentPending gates on
 * what it read, so this predicate is the only place that gate survives into
 * the database. Unguarded, two requests that both saw `pending` both write.
 *
 * The assignment row is not what the second writer ruins. A decline landing
 * after an accept reopens the work package the accept had just counted towards
 * `matched`, so the project holds a package /positions offers to somebody
 * else; a repeated answer also emits its outbox event twice.
 */
async function claimPendingAssignment(
  tx: Tx,
  assignmentId: string,
  updates: Partial<typeof projectAssignments.$inferInsert>,
): Promise<void> {
  const [claimed] = await tx
    .update(projectAssignments)
    .set(updates)
    .where(
      and(
        eq(projectAssignments.id, assignmentId),
        eq(projectAssignments.acceptanceStatus, 'pending'),
        eq(projectAssignments.status, 'active'),
      ),
    )
    .returning({ id: projectAssignments.id })
  if (claimed) return

  // Row is there but moved on: somebody answered this offer first.
  const [current] = await tx
    .select({ acceptanceStatus: projectAssignments.acceptanceStatus })
    .from(projectAssignments)
    .where(eq(projectAssignments.id, assignmentId))
    .limit(1)
  if (current) {
    throw new AppError('CONFLICT', `Offer is already ${current.acceptanceStatus}, not pending`)
  }
  throw new AppError('NOT_FOUND', 'Assignment not found')
}

matchingRoute.post('/assignments/:id/accept', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()
  const assignment = await loadOwnAssignment(db, c.req.param('id'), user.id)
  assertAssignmentPending(assignment)
  assertPayoutDestination(assignment)

  let complete = false
  await db.transaction(async (tx) => {
    // Serialize answers on the same project so two final acceptances cannot
    // each read the other's package as still pending and both skip the
    // team-complete event, leaving a fully-staffed team unannounced -- and so a
    // decline cannot reopen a package this transaction has already counted.
    // Project row first, then the assignment, then the work package: every
    // handler here takes them in that order, so none can deadlock the others.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, assignment.projectId))
      .for('update')

    await claimPendingAssignment(tx, assignment.id, { acceptanceStatus: 'accepted' })
    await tx
      .update(workPackages)
      .set({ status: 'assigned' })
      .where(eq(workPackages.id, assignment.workPackageId))

    // Contracts, conversations and the promotions the project may now be due,
    // shared with the application-accept path so the two doors into
    // project_assignments cannot leave the project in different states.
    complete = await finalizeStaffing(tx, {
      projectId: assignment.projectId,
      assignmentId: assignment.id,
      workPackageId: assignment.workPackageId,
      source: 'talent_accept',
    })

    /**
     * The owner asked; this is the answer.
     *
     * The decline half of this route has always published, and the accept half
     * published nothing at all unless it happened to be the acceptance that
     * completed the team - so an owner watching their matching page learned
     * about a "no" and never about a "yes". `talent.assignment.accepted` has
     * been in the catalogue the whole time with no publisher.
     *
     * Outside finalizeStaffing on purpose: that helper returns early while any
     * position is still open, which is exactly the partial accept the owner
     * most needs told about. Same payload shape as the decline and the
     * termination - the assignment names both parties, so the consumer
     * resolves the owner and the talent from it rather than trusting ids that
     * mean different things on either side of the wire.
     */
    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: assignment.projectId,
      eventType: TALENT_SUBJECTS.ASSIGNMENT_ACCEPTED,
      payload: {
        projectId: assignment.projectId,
        assignmentId: assignment.id,
        workPackageId: assignment.workPackageId,
        source: 'talent_accept',
      },
    })
  })

  // Let the escalation workflow exit now instead of waiting for its next poll.
  // A no-op when no workflow is running (single-worker never starts one).
  if (complete) {
    void signalTeamComplete(assignment.projectId).catch((err) => {
      console.warn('[temporal] team complete signal failed', {
        projectId: assignment.projectId,
        err,
      })
    })
  }

  return c.json({ success: true, data: { accepted: true, complete } })
})

matchingRoute.post('/assignments/:id/decline', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()
  const assignment = await loadOwnAssignment(db, c.req.param('id'), user.id)
  assertAssignmentPending(assignment)

  await db.transaction(async (tx) => {
    // Same lock accept takes, in the same place. Reopening the package is the
    // write that corrupts a concurrent acceptance, and no predicate on the
    // assignment row can guard a different row -- only serialising can. Project
    // row first, then the assignment, then the work package.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, assignment.projectId))
      .for('update')

    // Terminate the offer, not the talent's other work, and reopen the package
    // so it shows as a position for the owner to staff again.
    await claimPendingAssignment(tx, assignment.id, {
      acceptanceStatus: 'declined',
      status: 'terminated',
      completedAt: new Date(),
    })
    await tx
      .update(workPackages)
      .set({ status: 'unassigned' })
      .where(eq(workPackages.id, assignment.workPackageId))

    /**
     * The last decline needs nothing done.
     *
     * `team_forming` meant offers are out, and once every one had been answered
     * with a no the status was a lie with no exit, so this walked the project
     * back to `matching` by hand. The project never left `matching`, so there
     * is no walk back: a declined offer removes an assignment, the feeds keyed
     * on `matching` never stopped showing it, and the owner can staff again.
     */

    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: assignment.projectId,
      eventType: 'talent.assignment.declined',
      payload: {
        projectId: assignment.projectId,
        assignmentId: assignment.id,
        workPackageId: assignment.workPackageId,
        source: 'talent_decline',
      },
    })
  })

  return c.json({ success: true, data: { declined: true } })
})

/**
 * Before work starts the project has its own routes for restaffing, and
 * dropping a package out of a `matched` project would leave it matched with an
 * open seat - the state the transition guard exists to prevent. After review
 * begins there is no work left to reassign.
 */
function assertProjectRunning(status: string): void {
  if (status !== 'in_progress') {
    throw new AppError(
      'CONFLICT',
      `An assignment can only be ended while the project is running, not in '${status}'`,
    )
  }
}

/**
 * End an accepted assignment while the project is running.
 *
 * Nothing could do this. A talent who had to step away and an owner who had to
 * replace one had the same two options: leave the assignment in place forever,
 * or cancel the whole project and refund the escrow. `partially_active` exists
 * for exactly this - a project still running with a position open - and no code
 * path had ever written it, so the status was decoration.
 *
 * Either party may pull the plug: the owner because it is their project, the
 * talent because no one can be held to work they have left. The package returns
 * to 'unassigned' so /positions offers it again, and the project drops to
 * partially_active so it keeps running on the packages still staffed.
 *
 * completed_at is written only when the talent walks away. It is the column
 * findRecentAbandons reads, and an owner-initiated termination is not the
 * talent's abandonment to pay for.
 */
matchingRoute.post('/assignments/:id/terminate', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()
  const assignmentId = c.req.param('id')

  // loadOwnAssignment joins on talent_profiles.user_id and so only ever serves
  // the talent; the owner needs the project row to be recognised at all.
  const [assignment] = await db
    .select({
      id: projectAssignments.id,
      projectId: projectAssignments.projectId,
      workPackageId: projectAssignments.workPackageId,
      acceptanceStatus: projectAssignments.acceptanceStatus,
      status: projectAssignments.status,
      talentUserId: talentProfiles.userId,
      ownerId: projects.ownerId,
      projectStatus: projects.status,
    })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .innerJoin(projects, eq(projects.id, projectAssignments.projectId))
    .where(eq(projectAssignments.id, assignmentId))
    .limit(1)
  if (!assignment) throw new AppError('NOT_FOUND', 'Assignment not found')

  const byTalent = assignment.talentUserId === user.id
  const byOwner = assignment.ownerId === user.id
  if (!byTalent && !byOwner) {
    throw new AppError(
      'AUTH_FORBIDDEN',
      'Only the project owner or the assigned talent can end this assignment',
    )
  }

  if (assignment.status !== 'active') {
    throw new AppError('CONFLICT', `Assignment is already ${assignment.status}`)
  }
  // A pending offer is answered, not terminated: declining reopens the package
  // through the path that also guards the accept race.
  if (assignment.acceptanceStatus !== 'accepted') {
    throw new AppError('CONFLICT', 'Only an accepted assignment can be terminated')
  }
  // Cheap refusal on what the read above saw, so the common rejection costs no
  // transaction. The gate that counts is inside the lock below - this one is
  // read-check-write and the project can move between the two.
  assertProjectRunning(assignment.projectStatus)

  await db.transaction(async (tx) => {
    // Same lock as accept, decline and confirm, in the same position: the
    // project row before the work package row.
    const [locked] = await tx
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(eq(projects.id, assignment.projectId))
      .for('update')

    // Re-read under the lock. The assignment claim below is compare-and-set,
    // but the project status is a different row and nothing guarded it: a
    // termination racing the owner's move to review would otherwise reopen a
    // work package on a project that is no longer being built.
    assertProjectRunning(locked?.status ?? 'unknown')

    // Compare-and-set, so two terminations of the same assignment cannot both
    // reopen the package and both emit.
    const [claimed] = await tx
      .update(projectAssignments)
      .set({
        status: 'terminated',
        ...(byTalent ? { completedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(projectAssignments.id, assignment.id),
          eq(projectAssignments.status, 'active'),
          eq(projectAssignments.acceptanceStatus, 'accepted'),
        ),
      )
      .returning({ id: projectAssignments.id })
    if (!claimed) throw new AppError('CONFLICT', 'Assignment was already ended')

    await tx
      .update(workPackages)
      .set({ status: 'unassigned' })
      .where(eq(workPackages.id, assignment.workPackageId))

    // An open seat is not a different position. `partially_active` said "still
    // running, one position open", which the reopened work package above
    // already says - and saying it twice is what let the two disagree. The
    // project stays in_progress; the package is what is unassigned.
    await tx
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, assignment.projectId))

    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: assignment.projectId,
      eventType: TALENT_SUBJECTS.ASSIGNMENT_TERMINATED,
      payload: {
        projectId: assignment.projectId,
        assignmentId: assignment.id,
        workPackageId: assignment.workPackageId,
        source: byTalent ? 'talent_terminate' : 'owner_terminate',
      },
    })
  })

  return c.json({
    success: true,
    data: { terminated: true, workPackageReopened: assignment.workPackageId },
  })
})
