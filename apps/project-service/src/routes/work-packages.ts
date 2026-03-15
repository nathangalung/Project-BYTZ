import { getDb } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { ProjectRepository } from '../repositories/project.repository'
import { WorkPackageRepository } from '../repositories/work-package.repository'
import { WorkPackageService } from '../services/work-package.service'

const workPackageStatusValues = [
  'unassigned',
  'pending_acceptance',
  'assigned',
  'declined',
  'in_progress',
  'completed',
  'terminated',
] as const

const dependencyTypeValues = ['finish_to_start', 'start_to_start', 'finish_to_finish'] as const

const createWorkPackagesSchema = z.object({
  projectId: z.string(),
  packages: z.array(
    z.object({
      title: z.string().min(3).max(255),
      description: z.string().min(5).max(5000),
      requiredSkills: z.array(z.string()),
      estimatedHours: z.number().positive(),
      amount: z.number().int().positive(),
      workerPayout: z.number().int().positive(),
      orderIndex: z.number().int().nonnegative(),
    }),
  ),
})

const updateStatusSchema = z.object({
  status: z.enum(workPackageStatusValues),
})

const addDependencySchema = z.object({
  dependsOnWorkPackageId: z.string(),
  type: z.enum(dependencyTypeValues).optional(),
})

function getService(): WorkPackageService {
  const db = getDb()
  const wpRepo = new WorkPackageRepository(db)
  const projectRepo = new ProjectRepository(db)
  return new WorkPackageService(wpRepo, projectRepo)
}

export const workPackageRoute = new Hono()

// GET /project/:projectId - list work packages for a project
workPackageRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const service = getService()

  const packages = await service.listByProject(projectId)

  return c.json({
    success: true,
    data: packages,
  })
})

// GET /:id - get single work package
workPackageRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const service = getService()

  const wp = await service.getWorkPackage(id)

  return c.json({
    success: true,
    data: wp,
  })
})

// POST / - create work packages for a project (from PRD)
workPackageRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createWorkPackagesSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid work package data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const result = await service.createWorkPackages(parsed.data.projectId, parsed.data.packages)

  return c.json(
    {
      success: true,
      data: result,
    },
    201,
  )
})

// PATCH /:id/status - update work package status
workPackageRoute.patch('/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const result = await service.updateStatus(id, parsed.data.status)

  return c.json({
    success: true,
    data: result,
  })
})

// POST /:id/dependencies - add a dependency
workPackageRoute.post('/:id/dependencies', async (c) => {
  const workPackageId = c.req.param('id')
  const body = await c.req.json()

  const parsed = addDependencySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid dependency data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const dep = await service.addDependency(
    workPackageId,
    parsed.data.dependsOnWorkPackageId,
    parsed.data.type,
  )

  return c.json(
    {
      success: true,
      data: dep,
    },
    201,
  )
})

// GET /project/:projectId/dependencies - list all dependencies for a project
workPackageRoute.get('/project/:projectId/dependencies', async (c) => {
  const projectId = c.req.param('projectId')
  const service = getService()

  const deps = await service.getDependencies(projectId)

  return c.json({
    success: true,
    data: deps,
  })
})
