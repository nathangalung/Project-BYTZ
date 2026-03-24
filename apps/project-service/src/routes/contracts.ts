import {
  contracts,
  getDb,
  outboxEvents,
  projectAssignments,
  projects as projectsTable,
  talentProfiles,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'

const contractTypeValues = ['standard_nda', 'ip_transfer'] as const

const createContractSchema = z.object({
  projectId: z.string(),
  assignmentId: z.string(),
  type: z.enum(contractTypeValues),
  content: z.record(z.string(), z.unknown()),
})

const signContractSchema = z.object({
  role: z.enum(['owner', 'talent']),
})

export const contractRoute = new Hono()

// POST / - generate contract
contractRoute.post('/', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()

  const parsed = createContractSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid contract data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()

  // Verify user owns the project
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, parsed.data.projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
  }

  // Verify assignment exists
  const [assignment] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .where(eq(projectAssignments.id, parsed.data.assignmentId))
    .limit(1)

  if (!assignment) {
    throw new AppError('NOT_FOUND', 'Assignment not found')
  }

  const id = uuidv7()
  const [contract] = await db
    .insert(contracts)
    .values({
      id,
      projectId: parsed.data.projectId,
      assignmentId: parsed.data.assignmentId,
      type: parsed.data.type,
      content: parsed.data.content,
      signedByOwner: false,
      signedByTalent: false,
    })
    .returning()

  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'contract',
    aggregateId: contract.id,
    eventType: 'contract.created',
    payload: { contractId: contract.id, projectId: parsed.data.projectId, type: parsed.data.type },
  })

  return c.json(
    {
      success: true,
      data: contract,
    },
    201,
  )
})

// GET /:id - get contract
contractRoute.get('/:id', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const db = getDb()

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1)

  if (!contract) {
    throw new AppError('NOT_FOUND', 'Contract not found')
  }

  // Verify user is party to contract (project owner or assigned talent)
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, contract.projectId))
    .limit(1)

  const isOwner = project && project.ownerId === user.id

  if (!isOwner) {
    const [assignment] = await db
      .select({ talentId: projectAssignments.talentId })
      .from(projectAssignments)
      .where(eq(projectAssignments.id, contract.assignmentId))
      .limit(1)

    let isTalent = false
    if (assignment) {
      const [profile] = await db
        .select({ userId: talentProfiles.userId })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, assignment.talentId))
        .limit(1)
      isTalent = !!profile && profile.userId === user.id
    }

    if (!isTalent) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }
  }

  return c.json({
    success: true,
    data: contract,
  })
})

// GET /project/:projectId - list contracts for project
contractRoute.get('/project/:projectId', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')
  const db = getDb()

  // Verify user owns project or is an assigned talent
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  if (project.ownerId !== user.id) {
    // Check if user is an assigned talent on this project
    const [talentProfile] = await db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, user.id))
      .limit(1)

    if (!talentProfile) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }

    const [assignment] = await db
      .select({ id: projectAssignments.id })
      .from(projectAssignments)
      .where(
        and(
          eq(projectAssignments.projectId, projectId),
          eq(projectAssignments.talentId, talentProfile.id),
        ),
      )
      .limit(1)

    if (!assignment) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }
  }

  const projectContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.projectId, projectId))
    .orderBy(desc(contracts.createdAt))

  return c.json({
    success: true,
    data: projectContracts,
  })
})

// PATCH /:id/sign - sign contract
contractRoute.patch('/:id/sign', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = signContractSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid sign data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const db = getDb()

  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1)

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Contract not found')
  }

  // Verify the authenticated user is the correct party for the role
  if (parsed.data.role === 'owner') {
    const [project] = await db
      .select({ ownerId: projectsTable.ownerId })
      .from(projectsTable)
      .where(eq(projectsTable.id, existing.projectId))
      .limit(1)
    if (!project || project.ownerId !== user.id) {
      throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can sign as owner')
    }
  } else {
    const [assignment] = await db
      .select({ talentId: projectAssignments.talentId })
      .from(projectAssignments)
      .where(eq(projectAssignments.id, existing.assignmentId))
      .limit(1)
    if (!assignment) {
      throw new AppError('NOT_FOUND', 'Assignment not found')
    }
    // Verify the talent profile belongs to the authenticated user
    const [profile] = await db
      .select({ userId: talentProfiles.userId })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, assignment.talentId))
      .limit(1)
    if (!profile || profile.userId !== user.id) {
      throw new AppError('AUTH_FORBIDDEN', 'Only the assigned talent can sign as talent')
    }
  }

  const updateData: Record<string, unknown> = {}

  if (parsed.data.role === 'owner') {
    if (existing.signedByOwner) {
      throw new AppError('CONFLICT', 'Contract already signed by owner')
    }
    updateData.signedByOwner = true
  } else {
    if (existing.signedByTalent) {
      throw new AppError('CONFLICT', 'Contract already signed by talent')
    }
    updateData.signedByTalent = true
  }

  // Set signedAt when both parties signed
  const bothSigned =
    (parsed.data.role === 'owner' && existing.signedByTalent) ||
    (parsed.data.role === 'talent' && existing.signedByOwner)

  if (bothSigned) {
    updateData.signedAt = new Date()
  }

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(contracts)
      .set(updateData)
      .where(eq(contracts.id, id))
      .returning()

    // Emit outbox event for the signing action
    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'contract',
      aggregateId: id,
      eventType: 'contract.signed',
      payload: {
        contractId: id,
        projectId: existing.projectId,
        assignmentId: existing.assignmentId,
        signedByRole: parsed.data.role,
        bothSigned,
      },
    })

    // Emit additional event when both parties have signed
    if (bothSigned) {
      await tx.insert(outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'contract',
        aggregateId: id,
        eventType: 'contract.fully_executed',
        payload: {
          contractId: id,
          projectId: existing.projectId,
          assignmentId: existing.assignmentId,
        },
      })
    }

    return result
  })

  return c.json({
    success: true,
    data: updated,
  })
})
