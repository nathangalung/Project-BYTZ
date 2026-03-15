import { contracts, getDb, projectAssignments } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

const contractTypeValues = ['standard_nda', 'ip_transfer'] as const

const createContractSchema = z.object({
  projectId: z.string(),
  assignmentId: z.string(),
  type: z.enum(contractTypeValues),
  content: z.record(z.string(), z.unknown()),
})

const signContractSchema = z.object({
  role: z.enum(['client', 'worker']),
})

export const contractRoute = new Hono()

// POST / - generate contract
contractRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createContractSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid contract data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()

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
      signedByClient: false,
      signedByWorker: false,
    })
    .returning()

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
  const id = c.req.param('id')
  const db = getDb()

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1)

  if (!contract) {
    throw new AppError('NOT_FOUND', 'Contract not found')
  }

  return c.json({
    success: true,
    data: contract,
  })
})

// GET /project/:projectId - list contracts for project
contractRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const db = getDb()

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

  const db = getDb()

  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1)

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Contract not found')
  }

  const updateData: Record<string, unknown> = {}

  if (parsed.data.role === 'client') {
    if (existing.signedByClient) {
      throw new AppError('CONFLICT', 'Contract already signed by client')
    }
    updateData.signedByClient = true
  } else {
    if (existing.signedByWorker) {
      throw new AppError('CONFLICT', 'Contract already signed by worker')
    }
    updateData.signedByWorker = true
  }

  // Set signedAt when both parties signed
  const bothSigned =
    (parsed.data.role === 'client' && existing.signedByWorker) ||
    (parsed.data.role === 'worker' && existing.signedByClient)

  if (bothSigned) {
    updateData.signedAt = new Date()
  }

  const [updated] = await db
    .update(contracts)
    .set(updateData)
    .where(eq(contracts.id, id))
    .returning()

  return c.json({
    success: true,
    data: updated,
  })
})
