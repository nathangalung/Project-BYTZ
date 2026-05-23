import { getDb, outboxEvents, projects, talentProfiles } from '@kerjacus/db'
import {
  AppError,
  createTalentPlacementSchema,
  talentPlacementQuoteSchema,
  updateTalentPlacementStatusSchema,
} from '@kerjacus/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'
import { TalentPlacementRepository } from '../repositories/talent-placement.repository'

export const talentPlacementRoute = new Hono()

function getRepo() {
  return new TalentPlacementRepository(getDb())
}

// POST / - owner requests placement
talentPlacementRoute.post('/', async (c) => {
  const user = getAuthUser(c)
  if (user.role !== 'owner') {
    throw new AppError('AUTH_FORBIDDEN', 'Only project owners can request talent placement')
  }

  const body = await c.req.json()
  const parsed = createTalentPlacementSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid placement data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const db = getDb()

  // Validate project exists and belongs to owner
  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }
  if (project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Can only request placement for your own projects')
  }

  // Validate talent profile exists
  const [talent] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, parsed.data.talentId))
    .limit(1)

  if (!talent) {
    throw new AppError('NOT_FOUND', 'Talent profile not found')
  }

  const repo = getRepo()
  const created = await repo.create({
    projectId: parsed.data.projectId,
    ownerId: user.id,
    talentId: parsed.data.talentId,
    estimatedAnnualSalary: parsed.data.estimatedAnnualSalary,
  })

  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'talent_placement',
    aggregateId: created.id,
    eventType: 'talent_placement.requested',
    payload: {
      placementId: created.id,
      projectId: created.projectId,
      ownerId: created.ownerId,
      talentId: created.talentId,
    },
  })

  return c.json({ success: true, data: created }, 201)
})

// GET /me - owner's placement requests
talentPlacementRoute.get('/me', async (c) => {
  const user = getAuthUser(c)
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('pageSize') ?? 20)

  const repo = getRepo()

  if (user.role === 'owner') {
    const result = await repo.findByOwner(user.id, { page, pageSize })
    return c.json({
      success: true,
      data: { items: result.items, total: result.total, page, pageSize },
    })
  }

  if (user.role === 'talent') {
    const db = getDb()
    const [profile] = await db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, user.id))
      .limit(1)
    if (!profile) {
      return c.json({ success: true, data: { items: [], total: 0, page, pageSize } })
    }
    const result = await repo.findByTalent(profile.id, { page, pageSize })
    return c.json({
      success: true,
      data: { items: result.items, total: result.total, page, pageSize },
    })
  }

  throw new AppError('AUTH_FORBIDDEN', 'Role not permitted')
})

// GET /:id - owner OR talent can view their own
talentPlacementRoute.get('/:id', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')

  const repo = getRepo()
  const placement = await repo.findById(id)
  if (!placement) {
    throw new AppError('NOT_FOUND', 'Placement request not found')
  }

  // Owner check
  if (placement.ownerId === user.id) {
    return c.json({ success: true, data: placement })
  }

  // Talent check (resolve user -> talent profile)
  const db = getDb()
  const [profile] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, user.id))
    .limit(1)

  if (profile && profile.id === placement.talentId) {
    return c.json({ success: true, data: placement })
  }

  throw new AppError('AUTH_FORBIDDEN', 'Not authorized to view this placement request')
})

// PATCH /:id/status - update status
talentPlacementRoute.patch('/:id/status', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateTalentPlacementStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status update', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const repo = getRepo()
  const placement = await repo.findById(id)
  if (!placement) {
    throw new AppError('NOT_FOUND', 'Placement request not found')
  }

  const newStatus = parsed.data.status

  // Authorization: talent can set accepted/declined, owner can set in_discussion/completed
  const talentAllowed = ['accepted', 'declined'] as const
  const ownerAllowed = ['in_discussion', 'completed'] as const

  let authorized = false
  if (placement.ownerId === user.id) {
    if ((ownerAllowed as readonly string[]).includes(newStatus)) {
      authorized = true
    } else {
      throw new AppError(
        'AUTH_FORBIDDEN',
        'Owner can only set status to in_discussion or completed',
      )
    }
  } else {
    // Check if user is the talent
    const db = getDb()
    const [profile] = await db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, user.id))
      .limit(1)

    if (profile && profile.id === placement.talentId) {
      if ((talentAllowed as readonly string[]).includes(newStatus)) {
        authorized = true
      } else {
        throw new AppError('AUTH_FORBIDDEN', 'Talent can only set status to accepted or declined')
      }
    }
  }

  if (!authorized) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized to update this placement')
  }

  const updated = await repo.updateStatus(id, newStatus, parsed.data.notes)
  if (!updated) {
    throw new AppError('NOT_FOUND', 'Placement request not found')
  }

  const db = getDb()
  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'talent_placement',
    aggregateId: id,
    eventType: `talent_placement.${newStatus}`,
    payload: {
      placementId: id,
      projectId: updated.projectId,
      ownerId: updated.ownerId,
      talentId: updated.talentId,
      status: newStatus,
    },
  })

  return c.json({ success: true, data: updated })
})

// POST /:id/quote - calculate sliding scale fee
talentPlacementRoute.post('/:id/quote', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = talentPlacementQuoteSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid quote data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const repo = getRepo()
  const placement = await repo.findById(id)
  if (!placement) {
    throw new AppError('NOT_FOUND', 'Placement request not found')
  }

  // Only owner can request a quote
  if (placement.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the owner can request a quote')
  }

  const { estimatedAnnualSalary, durationMonths } = parsed.data

  // Sliding scale: shorter relationship => higher fee
  let conversionFeePercentage: number
  if (durationMonths < 12) {
    conversionFeePercentage = 0.15
  } else if (durationMonths <= 24) {
    conversionFeePercentage = 0.12
  } else {
    conversionFeePercentage = 0.1
  }

  const conversionFeeAmount = Math.round(estimatedAnnualSalary * conversionFeePercentage)

  const updated = await repo.updateFee(
    id,
    conversionFeePercentage,
    conversionFeeAmount,
    estimatedAnnualSalary,
  )

  if (!updated) {
    throw new AppError('NOT_FOUND', 'Placement request not found')
  }

  return c.json({
    success: true,
    data: {
      placementId: id,
      estimatedAnnualSalary,
      durationMonths,
      conversionFeePercentage,
      conversionFeeAmount,
      placement: updated,
    },
  })
})
