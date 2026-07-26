import {
  contracts,
  getDb,
  projectAssignments,
  projects as projectsTable,
  talentProfiles,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { appendOutboxEvent } from '../lib/outbox'
import { assertProjectAccess, assertProjectOwner } from '../lib/project-access'
import { getAuthUser } from '../middleware/session'

const contractTypeValues = ['standard_nda', 'ip_transfer'] as const

const createContractSchema = z.object({
  projectId: z.string(),
  assignmentId: z.string(),
  type: z.enum(contractTypeValues),
  content: z.record(z.string(), z.unknown()),
})

export const contractRoute = new Hono()

// POST / - generate contract
contractRoute.post('/', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()

  const parsed = createContractSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid contract data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const db = getDb()

  await assertProjectOwner(parsed.data.projectId, user.id)

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

  await appendOutboxEvent(db, {
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

  // Owner or an assigned talent - assertProjectAccess is that exact rule,
  // and it was reimplemented here as four queries and two error paths.
  await assertProjectAccess(projectId, user.id)

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
/**
 * A contract has exactly two signatories, and which one is calling follows
 * from the session alone: the project owner, or the talent assigned to the
 * work package this contract covers. So the party is derived here rather than
 * taken as a parameter - a client-declared role would be a claim the server
 * has to disprove on every call, and this route used to require one, which
 * made the button send a body it never had and fail for both parties.
 */
contractRoute.patch('/:id/sign', async (c) => {
  const id = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1)

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Contract not found')
  }

  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, existing.projectId))
    .limit(1)

  const [assignedTalent] = await db
    .select({ userId: talentProfiles.userId })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(eq(projectAssignments.id, existing.assignmentId))
    .limit(1)

  const role =
    project?.ownerId === user.id
      ? 'owner'
      : assignedTalent?.userId === user.id
        ? 'talent'
        : undefined

  if (!role) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner or the assigned talent can sign')
  }

  const updateData: Record<string, unknown> = {}

  if (role === 'owner') {
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
    (role === 'owner' && existing.signedByTalent) || (role === 'talent' && existing.signedByOwner)

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
    await appendOutboxEvent(tx, {
      aggregateType: 'contract',
      aggregateId: id,
      eventType: 'contract.signed',
      payload: {
        contractId: id,
        projectId: existing.projectId,
        assignmentId: existing.assignmentId,
        signedByRole: role,
        bothSigned,
      },
    })

    // Emit additional event when both parties have signed
    if (bothSigned) {
      await appendOutboxEvent(tx, {
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
