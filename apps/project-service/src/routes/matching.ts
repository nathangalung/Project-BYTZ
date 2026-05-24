import { getDb, projectAssignments, projects, workPackages } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { appendOutboxEvent } from '../lib/outbox'
import { getAuthUser } from '../middleware/session'
import { MatchingRepository } from '../repositories/matching.repository'
import { MatchingService } from '../services/matching.service'

const recommendSchema = z.object({
  requiredSkills: z.array(z.string()).min(1),
  excludeTalentIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
})

const confirmSchema = z.object({
  projectId: z.string().min(1),
  approvedTalentIds: z.array(z.string()).min(1),
})

function getService(): MatchingService {
  const db = getDb()
  const repo = new MatchingRepository(db)
  return new MatchingService(repo)
}

export const matchingRoute = new Hono()

// POST /recommend - get talent recommendations for required skills
matchingRoute.post('/recommend', async (c) => {
  getAuthUser(c)
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

// POST /confirm - client confirms talent selection, creates assignments, transitions to matched
matchingRoute.post('/confirm', async (c) => {
  getAuthUser(c)
  const body = await c.req.json()

  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid confirm parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { projectId, approvedTalentIds } = parsed.data
  const db = getDb()

  const wps = await db
    .select({ id: workPackages.id, orderIndex: workPackages.orderIndex })
    .from(workPackages)
    .where(and(eq(workPackages.projectId, projectId), inArray(workPackages.status, ['unassigned'])))
    .orderBy(asc(workPackages.orderIndex))

  if (wps.length === 0) {
    throw new AppError('MATCHING_NO_WORK_PACKAGES', 'No unassigned work packages found')
  }

  const pairs = approvedTalentIds.slice(0, wps.length).map((talentId, i) => ({
    talentId,
    workPackageId: wps[i].id,
  }))

  await db.transaction(async (tx) => {
    for (const { talentId, workPackageId } of pairs) {
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
      .set({ status: 'matched', updatedAt: new Date() })
      .where(
        and(eq(projects.id, projectId), inArray(projects.status, ['matching', 'team_forming'])),
      )

    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: 'project.team.complete',
      payload: { projectId, approvedTalentIds, source: 'client_confirm' },
    })
  })

  return c.json({ success: true, data: { projectId, matched: pairs.length } })
})
