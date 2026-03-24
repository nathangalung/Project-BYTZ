import {
  getDb,
  outboxEvents,
  projectAssignments,
  projects,
  reviews,
  talentProfiles,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'

const reviewTypeValues = ['owner_to_talent', 'talent_to_owner'] as const

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
    .where(eq(reviews.type, 'owner_to_talent'))
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

  const user = getAuthUser(c)
  const reviewerId = user.id

  const db = getDb()

  // Verify the reviewer was involved in the project (as owner or assigned talent)
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId))
    .limit(1)
  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  let isParticipant = project.ownerId === reviewerId
  if (!isParticipant) {
    // Check if the user is an assigned talent on this project
    const talentAssignments = await db
      .select({ talentId: projectAssignments.talentId })
      .from(projectAssignments)
      .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
      .where(
        and(
          eq(projectAssignments.projectId, parsed.data.projectId),
          eq(talentProfiles.userId, reviewerId),
        ),
      )
      .limit(1)
    isParticipant = talentAssignments.length > 0
  }

  if (!isParticipant) {
    throw new AppError('AUTH_FORBIDDEN', 'Only project participants can leave reviews')
  }

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
  const review = await db.transaction(async (tx) => {
    const [created] = await tx
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

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'review',
      aggregateId: id,
      eventType: 'review.created',
      payload: {
        reviewId: id,
        projectId: parsed.data.projectId,
        reviewerId,
        revieweeId: parsed.data.revieweeId,
        type: parsed.data.type,
        rating: parsed.data.rating,
      },
    })

    return created
  })

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
