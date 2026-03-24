import { getDb } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'
import { MatchingRepository } from '../repositories/matching.repository'
import { MatchingService } from '../services/matching.service'

const recommendSchema = z.object({
  requiredSkills: z.array(z.string()).min(1),
  excludeTalentIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
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
      issues: parsed.error.flatten().fieldErrors,
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
