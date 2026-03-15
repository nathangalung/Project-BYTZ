import { getDb, reviews } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

const reviewTypeValues = ['client_to_worker', 'worker_to_client'] as const

const createReviewBodySchema = z.object({
  projectId: z.string(),
  revieweeId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  type: z.enum(reviewTypeValues),
})

export const reviewRoute = new Hono()

// GET /public — featured reviews
reviewRoute.get('/public', async (c) => {
  const db = getDb()
  const items = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      type: reviews.type,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(eq(reviews.type, 'client_to_worker'))
    .orderBy(desc(reviews.createdAt))
    .limit(6)
  return c.json({ success: true, data: items })
})

// POST / - create review
reviewRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createReviewBodySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid review data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const reviewerId = c.req.header('X-User-ID')
  if (!reviewerId) {
    throw new AppError('AUTH_UNAUTHORIZED', 'User ID is required')
  }

  const db = getDb()

  // Prevent duplicate reviews
  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.projectId, parsed.data.projectId),
        eq(reviews.reviewerId, reviewerId),
        eq(reviews.revieweeId, parsed.data.revieweeId),
      ),
    )
    .limit(1)

  if (existing) {
    throw new AppError('CONFLICT', 'Review already exists for this project')
  }

  const id = uuidv7()
  const [review] = await db
    .insert(reviews)
    .values({
      id,
      projectId: parsed.data.projectId,
      reviewerId,
      revieweeId: parsed.data.revieweeId,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
      type: parsed.data.type,
      isVisibleToReviewee: true,
    })
    .returning()

  return c.json(
    {
      success: true,
      data: review,
    },
    201,
  )
})

// GET /project/:projectId - reviews for project
reviewRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const db = getDb()

  const projectReviews = await db
    .select()
    .from(reviews)
    .where(eq(reviews.projectId, projectId))
    .orderBy(desc(reviews.createdAt))

  return c.json({
    success: true,
    data: projectReviews,
  })
})

// GET /user/:userId - reviews for user (internal)
reviewRoute.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId')
  const db = getDb()

  const userReviews = await db
    .select()
    .from(reviews)
    .where(eq(reviews.revieweeId, userId))
    .orderBy(desc(reviews.createdAt))

  return c.json({
    success: true,
    data: userReviews,
  })
})
