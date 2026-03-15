import { getDb } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { MatchingRepository } from '../repositories/matching.repository'
import { MatchingService } from '../services/matching.service'

const recommendSchema = z.object({
  requiredSkills: z.array(z.string()).min(1),
  excludeWorkerIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
})

function getService(): MatchingService {
  const db = getDb()
  const repo = new MatchingRepository(db)
  return new MatchingService(repo)
}

export const matchingRoute = new Hono()

// POST /recommend - get worker recommendations for required skills
matchingRoute.post('/recommend', async (c) => {
  const body = await c.req.json()

  const parsed = recommendSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid matching parameters', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const result = await service.matchWorkersToProject(
    parsed.data.requiredSkills,
    parsed.data.excludeWorkerIds ?? [],
    parsed.data.limit ?? 10,
  )

  if (result.recommendations.length === 0) {
    throw new AppError(
      'MATCHING_NO_WORKERS_FOUND',
      'No eligible workers found for the requested skills',
    )
  }

  return c.json({
    success: true,
    data: result,
  })
})
