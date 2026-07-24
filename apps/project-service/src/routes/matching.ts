import { getDb, projectAssignments, projects, talentProfiles, workPackages } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { env } from '../lib/env'
import { appendOutboxEvent } from '../lib/outbox'
import { assertProjectOwner } from '../lib/project-access'
import {
  allPackagesStaffed,
  assertAssignmentPending,
  validateTeamAssignments,
} from '../lib/team-assignment'
import { signalTeamComplete, startTeamFormationWorkflow } from '../lib/team-formation-workflow'
import { getAuthUser } from '../middleware/session'
import { MatchingRepository } from '../repositories/matching.repository'
import { MatchingService } from '../services/matching.service'

function hasServiceAuth(c: Context): boolean {
  const header = c.req.header('X-Service-Auth')
  return Boolean(env.SERVICE_AUTH_SECRET) && header === env.SERVICE_AUTH_SECRET
}

const recommendSchema = z.object({
  // Empty is allowed: with no skill target, ranking falls to fairness and track
  // record rather than collapsing every candidate to a zero skill score.
  requiredSkills: z.array(z.string()),
  excludeTalentIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
})

const confirmSchema = z.object({
  projectId: z.string().min(1),
  // One talent per work package. The owner staffs each open position; the
  // project reaches matched only once every package is covered.
  assignments: z
    .array(z.object({ workPackageId: z.string().min(1), talentId: z.string().min(1) }))
    .min(1),
})

function getService(): MatchingService {
  const db = getDb()
  const repo = new MatchingRepository(db)
  return new MatchingService(repo)
}

export const matchingRoute = new Hono()

// POST /recommend - get talent recommendations for required skills
matchingRoute.post('/recommend', async (c) => {
  if (!hasServiceAuth(c)) getAuthUser(c)
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

  const positions = wps.map((w) => ({
    workPackageId: w.id,
    title: w.title,
    requiredSkills: (w.requiredSkills as string[]) ?? [],
    recommendations: recsByPackage.get(w.id) ?? [],
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
// enters team_forming until every talent accepts.
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

  // Prior status distinguishes the first staffing (matching) from restaffing a
  // declined position (already team_forming), so the escalation timer starts once.
  const [proj] = await db
    .select({ status: projects.status, teamSize: projects.teamSize })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

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

  // Confirm only makes offers: each staffed package waits for its talent to
  // accept. The project moves to team_forming, and reaches matched only once
  // every offer is accepted (see /assignments/:id/accept), never here -- so a
  // later decline never has to drag a matched project back to forming.
  await db.transaction(async (tx) => {
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

    await tx
      .update(projects)
      .set({ status: 'team_forming', updatedAt: new Date() })
      .where(
        and(eq(projects.id, projectId), inArray(projects.status, ['matching', 'team_forming'])),
      )

    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: 'project.team.forming',
      payload: { projectId, assignments, source: 'client_confirm' },
    })
  })

  // Start the 14-day escalation timer the first time the project enters team
  // formation, and only for a real team; single-worker never needs it.
  if (proj?.status === 'matching' && (proj.teamSize ?? 1) > 1) {
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
    })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(and(eq(projectAssignments.id, assignmentId), eq(talentProfiles.userId, userId)))
    .limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Assignment not found')
  return row
}

matchingRoute.post('/assignments/:id/accept', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()
  const assignment = await loadOwnAssignment(db, c.req.param('id'), user.id)
  assertAssignmentPending(assignment)

  let complete = false
  await db.transaction(async (tx) => {
    await tx
      .update(projectAssignments)
      .set({ acceptanceStatus: 'accepted' })
      .where(eq(projectAssignments.id, assignment.id))
    await tx
      .update(workPackages)
      .set({ status: 'assigned' })
      .where(eq(workPackages.id, assignment.workPackageId))

    // Read package statuses inside the transaction so the just-accepted package
    // is counted; matched only when every package is now accepted.
    const pkgs = await tx
      .select({ status: workPackages.status })
      .from(workPackages)
      .where(eq(workPackages.projectId, assignment.projectId))
    complete = allPackagesStaffed(pkgs.map((p) => p.status))
    if (complete) {
      await tx
        .update(projects)
        .set({ status: 'matched', updatedAt: new Date() })
        .where(and(eq(projects.id, assignment.projectId), eq(projects.status, 'team_forming')))
      await appendOutboxEvent(tx, {
        aggregateType: 'project',
        aggregateId: assignment.projectId,
        eventType: 'project.team.complete',
        payload: { projectId: assignment.projectId, source: 'talent_accept' },
      })
    }
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
    // Terminate the offer, not the talent's other work, and reopen the package
    // so it shows as a position for the owner to staff again.
    await tx
      .update(projectAssignments)
      .set({ acceptanceStatus: 'declined', status: 'terminated', completedAt: new Date() })
      .where(eq(projectAssignments.id, assignment.id))
    await tx
      .update(workPackages)
      .set({ status: 'unassigned' })
      .where(eq(workPackages.id, assignment.workPackageId))
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
