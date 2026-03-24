import { AppError, FREE_REVISION_ROUNDS } from '@kerjacus/shared'
import { describe, expect, it, vi } from 'vitest'
import { MilestoneService } from './milestone.service'
import { ProjectService } from './project.service'
import { WorkPackageService } from './work-package.service'

// ── Mock repository factories ──

function createMockProjectRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(),
    findByOwnerId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    list: vi.fn(),
    getStatusLogs: vi.fn(),
    ...overrides,
  }
}

function createMockWorkPackageRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    updateStatus: vi.fn(),
    getDependencies: vi.fn(),
    getDependenciesByProject: vi.fn(),
    createDependency: vi.fn(),
    ...overrides,
  }
}

function createMockMilestoneRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    incrementRevisionCount: vi.fn(),
    ...overrides,
  }
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-001',
    ownerId: 'owner-001',
    title: 'Test Project',
    description: 'A test project',
    category: 'web_app',
    status: 'draft',
    budgetMin: 1_000_000,
    budgetMax: 5_000_000,
    estimatedTimelineDays: 30,
    teamSize: 1,
    finalPrice: null,
    platformFee: null,
    talentPayout: null,
    preferences: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

function makeWorkPackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wp-001',
    projectId: 'proj-001',
    title: 'Frontend Development',
    description: 'Build the frontend',
    orderIndex: 0,
    requiredSkills: ['React', 'TypeScript'],
    estimatedHours: 80,
    amount: 2_000_000,
    talentPayout: 1_600_000,
    status: 'unassigned',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ms-001',
    projectId: 'proj-001',
    workPackageId: null,
    assignedTalentId: null,
    title: 'Milestone 1',
    description: 'First milestone',
    milestoneType: 'individual',
    orderIndex: 0,
    amount: 1_000_000,
    status: 'pending',
    revisionCount: 0,
    dueDate: new Date('2026-04-30'),
    submittedAt: null,
    completedAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── ProjectService tests ──

describe('ProjectService', () => {
  describe('createProject', () => {
    it('creates a project with valid input', async () => {
      const created = makeProject()
      const repo = createMockProjectRepo({ create: vi.fn().mockResolvedValue(created) })
      const service = new ProjectService(repo as never)

      const result = await service.createProject('owner-001', {
        title: 'Test Project',
        description: 'A test project',
        category: 'web_app',
        budgetMin: 1_000_000,
        budgetMax: 5_000_000,
        estimatedTimelineDays: 30,
      })

      expect(result).toEqual(created)
      expect(repo.create).toHaveBeenCalledOnce()
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-001',
          status: 'draft',
          teamSize: 1,
        }),
      )
    })

    it('rejects budgetMax < budgetMin', async () => {
      const repo = createMockProjectRepo()
      const service = new ProjectService(repo as never)

      await expect(
        service.createProject('owner-001', {
          title: 'Test',
          description: 'A test project',
          category: 'web_app',
          budgetMin: 5_000_000,
          budgetMax: 1_000_000,
          estimatedTimelineDays: 30,
        }),
      ).rejects.toThrow(AppError)

      await expect(
        service.createProject('owner-001', {
          title: 'Test',
          description: 'A test project',
          category: 'web_app',
          budgetMin: 5_000_000,
          budgetMax: 1_000_000,
          estimatedTimelineDays: 30,
        }),
      ).rejects.toThrow('budgetMax must be >= budgetMin')
    })
  })

  describe('getProject', () => {
    it('returns project if found', async () => {
      const project = makeProject()
      const repo = createMockProjectRepo({ findById: vi.fn().mockResolvedValue(project) })
      const service = new ProjectService(repo as never)

      const result = await service.getProject('proj-001')
      expect(result).toEqual(project)
    })

    it('throws PROJECT_NOT_FOUND if not found', async () => {
      const repo = createMockProjectRepo({ findById: vi.fn().mockResolvedValue(undefined) })
      const service = new ProjectService(repo as never)

      await expect(service.getProject('nonexistent')).rejects.toThrow(AppError)
      await expect(service.getProject('nonexistent')).rejects.toThrow('Project not found')
    })
  })

  describe('transitionStatus', () => {
    it('allows draft -> scoping', async () => {
      const project = makeProject({ status: 'draft' })
      const updated = makeProject({ status: 'scoping' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const service = new ProjectService(repo as never)

      const result = await service.transitionStatus('proj-001', 'scoping', 'user-001')
      expect(result).toBeDefined()
      expect(result?.status).toBe('scoping')
      expect(repo.updateStatus).toHaveBeenCalledWith('proj-001', 'scoping', 'user-001', undefined)
    })

    it('allows scoping -> brd_generated', async () => {
      const project = makeProject({ status: 'scoping' })
      const updated = makeProject({ status: 'brd_generated' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const service = new ProjectService(repo as never)

      const result = await service.transitionStatus('proj-001', 'brd_generated', 'user-001')
      expect(result).toBeDefined()
      expect(result?.status).toBe('brd_generated')
    })

    it('allows draft -> cancelled', async () => {
      const project = makeProject({ status: 'draft' })
      const updated = makeProject({ status: 'cancelled' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const service = new ProjectService(repo as never)

      const result = await service.transitionStatus(
        'proj-001',
        'cancelled',
        'user-001',
        'Client cancelled',
      )
      expect(result).toBeDefined()
      expect(result?.status).toBe('cancelled')
    })

    it('allows in_progress -> disputed', async () => {
      const project = makeProject({ status: 'in_progress' })
      const updated = makeProject({ status: 'disputed' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const service = new ProjectService(repo as never)

      const result = await service.transitionStatus('proj-001', 'disputed', 'user-001')
      expect(result).toBeDefined()
      expect(result?.status).toBe('disputed')
    })

    it('rejects invalid transitions (draft -> completed)', async () => {
      const project = makeProject({ status: 'draft' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(service.transitionStatus('proj-001', 'completed', 'user-001')).rejects.toThrow(
        AppError,
      )

      try {
        await service.transitionStatus('proj-001', 'completed', 'user-001')
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        const appErr = err as AppError
        expect(appErr.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
        expect(appErr.details).toHaveProperty('currentStatus', 'draft')
        expect(appErr.details).toHaveProperty('targetStatus', 'completed')
        expect(appErr.details).toHaveProperty('validTargets')
      }
    })

    it('rejects transition from cancelled state', async () => {
      const project = makeProject({ status: 'cancelled' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(service.transitionStatus('proj-001', 'in_progress', 'user-001')).rejects.toThrow(
        AppError,
      )

      try {
        await service.transitionStatus('proj-001', 'in_progress', 'user-001')
      } catch (err) {
        const appErr = err as AppError
        expect(appErr.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
        expect(appErr.message).toContain('cancelled')
      }
    })

    it('rejects transition from completed state', async () => {
      const project = makeProject({ status: 'completed' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(service.transitionStatus('proj-001', 'in_progress', 'user-001')).rejects.toThrow(
        AppError,
      )
    })

    it('rejects transition from brd_purchased (final)', async () => {
      const project = makeProject({ status: 'brd_purchased' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(service.transitionStatus('proj-001', 'scoping', 'user-001')).rejects.toThrow(
        AppError,
      )
    })

    it('throws PROJECT_NOT_FOUND for missing project', async () => {
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new ProjectService(repo as never)

      await expect(service.transitionStatus('nonexistent', 'scoping', 'user-001')).rejects.toThrow(
        'Project not found',
      )
    })
  })

  describe('updateProject', () => {
    it('updates project in draft status', async () => {
      const project = makeProject({ status: 'draft' })
      const updated = makeProject({ status: 'draft', title: 'Updated Title' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        update: vi.fn().mockResolvedValue(updated),
      })
      const service = new ProjectService(repo as never)

      const result = await service.updateProject('proj-001', 'user-001', { title: 'Updated Title' })
      expect(result).toBeDefined()
      expect(result?.title).toBe('Updated Title')
    })

    it('allows editing in scoping status', async () => {
      const project = makeProject({ status: 'scoping' })
      const updated = makeProject({ status: 'scoping', description: 'Updated' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        update: vi.fn().mockResolvedValue(updated),
      })
      const service = new ProjectService(repo as never)

      const result = await service.updateProject('proj-001', 'user-001', { description: 'Updated' })
      expect(result).toBeDefined()
    })

    it('rejects editing in in_progress status', async () => {
      const project = makeProject({ status: 'in_progress' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(
        service.updateProject('proj-001', 'user-001', { title: 'Nope' }),
      ).rejects.toThrow(AppError)

      try {
        await service.updateProject('proj-001', 'user-001', { title: 'Nope' })
      } catch (err) {
        const appErr = err as AppError
        expect(appErr.code).toBe('PROJECT_VALIDATION_INVALID_STATUS')
      }
    })

    it('rejects editing in completed status', async () => {
      const project = makeProject({ status: 'completed' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(
        service.updateProject('proj-001', 'user-001', { title: 'Nope' }),
      ).rejects.toThrow(AppError)
    })

    it('rejects budgetMax < budgetMin on update', async () => {
      const project = makeProject({ status: 'draft' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      const service = new ProjectService(repo as never)

      await expect(
        service.updateProject('proj-001', 'user-001', {
          budgetMin: 10_000_000,
          budgetMax: 5_000_000,
        }),
      ).rejects.toThrow('budgetMax must be >= budgetMin')
    })

    it('throws PROJECT_NOT_FOUND when project missing on update', async () => {
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new ProjectService(repo as never)

      await expect(
        service.updateProject('nonexistent', 'user-001', { title: 'X' }),
      ).rejects.toThrow('Project not found')
    })

    it('throws when repo.update returns undefined', async () => {
      const project = makeProject({ status: 'draft' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        update: vi.fn().mockResolvedValue(undefined),
      })
      const service = new ProjectService(repo as never)

      await expect(service.updateProject('proj-001', 'user-001', { title: 'X' })).rejects.toThrow(
        'Project not found during update',
      )
    })
  })

  describe('listProjects', () => {
    it('delegates to repo.list with filters and pagination', async () => {
      const projects = [makeProject(), makeProject({ id: 'proj-002' })]
      const repo = createMockProjectRepo({
        list: vi.fn().mockResolvedValue({ items: projects, total: 2 }),
      })
      const service = new ProjectService(repo as never)

      const result = await service.listProjects({ status: 'draft' } as never, {
        page: 1,
        pageSize: 10,
      })
      expect(result).toBeDefined()
      expect(result.items).toHaveLength(2)
      expect(repo.list).toHaveBeenCalledWith({ status: 'draft' }, { page: 1, pageSize: 10 })
    })
  })

  describe('listOwnerProjects', () => {
    it('delegates to repo.findByOwnerId', async () => {
      const projects = [makeProject()]
      const repo = createMockProjectRepo({
        findByOwnerId: vi.fn().mockResolvedValue({ items: projects, total: 1 }),
      })
      const service = new ProjectService(repo as never)

      const result = await service.listOwnerProjects('owner-001', { page: 1, pageSize: 10 })
      expect(result).toBeDefined()
      expect(result.items).toHaveLength(1)
      expect(repo.findByOwnerId).toHaveBeenCalledWith('owner-001', { page: 1, pageSize: 10 })
    })
  })

  describe('getStatusLogs', () => {
    it('returns status logs for existing project', async () => {
      const logs = [{ id: 'log-1', fromStatus: 'draft', toStatus: 'scoping' }]
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
        getStatusLogs: vi.fn().mockResolvedValue(logs),
      })
      const service = new ProjectService(repo as never)

      const result = await service.getStatusLogs('proj-001')
      expect(result).toEqual(logs)
      expect(repo.getStatusLogs).toHaveBeenCalledWith('proj-001')
    })

    it('throws PROJECT_NOT_FOUND when project missing', async () => {
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new ProjectService(repo as never)

      await expect(service.getStatusLogs('nonexistent')).rejects.toThrow('Project not found')
    })
  })

  describe('transitionStatus edge cases', () => {
    it('throws when updateStatus returns undefined', async () => {
      const project = makeProject({ status: 'draft' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      })
      const service = new ProjectService(repo as never)

      await expect(service.transitionStatus('proj-001', 'scoping', 'user-001')).rejects.toThrow(
        'Project not found during update',
      )
    })
  })
})

// ── WorkPackageService tests ──

describe('WorkPackageService', () => {
  describe('addDependency', () => {
    it('rejects self-dependency', async () => {
      const wp = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockResolvedValue(wp),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.addDependency('wp-A', 'wp-A')).rejects.toThrow(
        'Work package cannot depend on itself',
      )
    })

    it('rejects circular dependency (A -> B -> A)', async () => {
      const wpA = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpB = makeWorkPackage({ id: 'wp-B', projectId: 'proj-001' })

      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'wp-A') return Promise.resolve(wpA)
          if (id === 'wp-B') return Promise.resolve(wpB)
          return Promise.resolve(undefined)
        }),
        // Existing dep: B -> A (B depends on A)
        getDependenciesByProject: vi
          .fn()
          .mockResolvedValue([
            { workPackageId: 'wp-B', dependsOnWorkPackageId: 'wp-A', type: 'finish_to_start' },
          ]),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      // Try to add A -> B (A depends on B), which creates cycle A -> B -> A
      await expect(service.addDependency('wp-A', 'wp-B')).rejects.toThrow(
        'Adding this dependency would create a cycle',
      )
    })

    it('rejects circular dependency (A -> B -> C -> A)', async () => {
      const wpA = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpB = makeWorkPackage({ id: 'wp-B', projectId: 'proj-001' })
      const wpC = makeWorkPackage({ id: 'wp-C', projectId: 'proj-001' })

      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'wp-A') return Promise.resolve(wpA)
          if (id === 'wp-B') return Promise.resolve(wpB)
          if (id === 'wp-C') return Promise.resolve(wpC)
          return Promise.resolve(undefined)
        }),
        // Existing deps: B -> A, C -> B (chain: C -> B -> A)
        getDependenciesByProject: vi.fn().mockResolvedValue([
          { workPackageId: 'wp-B', dependsOnWorkPackageId: 'wp-A', type: 'finish_to_start' },
          { workPackageId: 'wp-C', dependsOnWorkPackageId: 'wp-B', type: 'finish_to_start' },
        ]),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      // Try to add A -> C (A depends on C), creating cycle A -> C -> B -> A
      await expect(service.addDependency('wp-A', 'wp-C')).rejects.toThrow(
        'Adding this dependency would create a cycle',
      )
    })

    it('allows valid DAG dependency', async () => {
      const wpA = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpB = makeWorkPackage({ id: 'wp-B', projectId: 'proj-001' })
      const depResult = {
        id: 'dep-001',
        workPackageId: 'wp-B',
        dependsOnWorkPackageId: 'wp-A',
        type: 'finish_to_start',
      }

      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'wp-A') return Promise.resolve(wpA)
          if (id === 'wp-B') return Promise.resolve(wpB)
          return Promise.resolve(undefined)
        }),
        getDependenciesByProject: vi.fn().mockResolvedValue([]),
        createDependency: vi.fn().mockResolvedValue(depResult),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.addDependency('wp-B', 'wp-A')
      expect(result).toEqual(depResult)
      expect(wpRepo.createDependency).toHaveBeenCalledWith({
        workPackageId: 'wp-B',
        dependsOnWorkPackageId: 'wp-A',
        type: undefined,
      })
    })

    it('allows valid dependency with custom type', async () => {
      const wpA = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpB = makeWorkPackage({ id: 'wp-B', projectId: 'proj-001' })
      const depResult = {
        id: 'dep-001',
        workPackageId: 'wp-B',
        dependsOnWorkPackageId: 'wp-A',
        type: 'start_to_start',
      }

      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'wp-A') return Promise.resolve(wpA)
          if (id === 'wp-B') return Promise.resolve(wpB)
          return Promise.resolve(undefined)
        }),
        getDependenciesByProject: vi.fn().mockResolvedValue([]),
        createDependency: vi.fn().mockResolvedValue(depResult),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.addDependency('wp-B', 'wp-A', 'start_to_start')
      expect(result).toBeDefined()
      expect(result?.type).toBe('start_to_start')
    })

    it('rejects if work packages belong to different projects', async () => {
      const wpA = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpB = makeWorkPackage({ id: 'wp-B', projectId: 'proj-002' })

      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'wp-A') return Promise.resolve(wpA)
          if (id === 'wp-B') return Promise.resolve(wpB)
          return Promise.resolve(undefined)
        }),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.addDependency('wp-A', 'wp-B')).rejects.toThrow(
        'Work packages must belong to the same project',
      )
    })

    it('throws NOT_FOUND if work package does not exist', async () => {
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.addDependency('wp-missing', 'wp-A')).rejects.toThrow(
        'Work package not found',
      )
    })

    it('throws NOT_FOUND if dependency target does not exist', async () => {
      const wpA = makeWorkPackage({ id: 'wp-A', projectId: 'proj-001' })
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'wp-A') return Promise.resolve(wpA)
          return Promise.resolve(undefined)
        }),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.addDependency('wp-A', 'wp-missing')).rejects.toThrow(
        'Dependency work package not found',
      )
    })
  })

  describe('listByProject', () => {
    it('throws if project not found', async () => {
      const wpRepo = createMockWorkPackageRepo()
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.listByProject('nonexistent')).rejects.toThrow('Project not found')
    })

    it('returns work packages for valid project', async () => {
      const wps = [makeWorkPackage(), makeWorkPackage({ id: 'wp-002' })]
      const wpRepo = createMockWorkPackageRepo({
        findByProjectId: vi.fn().mockResolvedValue(wps),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.listByProject('proj-001')
      expect(result).toHaveLength(2)
    })
  })

  describe('createWorkPackages', () => {
    it('creates multiple work packages', async () => {
      const created = [makeWorkPackage(), makeWorkPackage({ id: 'wp-002' })]
      const wpRepo = createMockWorkPackageRepo({
        createMany: vi.fn().mockResolvedValue(created),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.createWorkPackages('proj-001', [
        {
          title: 'Frontend',
          description: 'Build frontend',
          requiredSkills: ['React'],
          estimatedHours: 80,
          amount: 2_000_000,
          talentPayout: 1_600_000,
          orderIndex: 0,
        },
        {
          title: 'Backend',
          description: 'Build backend',
          requiredSkills: ['Node.js'],
          estimatedHours: 100,
          amount: 2_500_000,
          talentPayout: 2_000_000,
          orderIndex: 1,
        },
      ])

      expect(result).toHaveLength(2)
      expect(wpRepo.createMany).toHaveBeenCalledOnce()
    })
  })

  describe('getWorkPackage', () => {
    it('returns work package when found', async () => {
      const wp = makeWorkPackage()
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockResolvedValue(wp),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.getWorkPackage('wp-001')
      expect(result).toEqual(wp)
    })

    it('throws NOT_FOUND when work package missing', async () => {
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.getWorkPackage('nonexistent')).rejects.toThrow('Work package not found')
    })
  })

  describe('updateStatus', () => {
    it('updates status of existing work package', async () => {
      const wp = makeWorkPackage({ status: 'unassigned' })
      const updated = makeWorkPackage({ status: 'assigned' })
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockResolvedValue(wp),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.updateStatus('wp-001', 'assigned')
      expect(result).toBeDefined()
      expect(result?.status).toBe('assigned')
    })

    it('throws NOT_FOUND when work package missing', async () => {
      const wpRepo = createMockWorkPackageRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const projRepo = createMockProjectRepo()
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.updateStatus('nonexistent', 'assigned')).rejects.toThrow(
        'Work package not found',
      )
    })
  })

  describe('getDependencies', () => {
    it('returns dependencies for existing project', async () => {
      const deps = [
        { workPackageId: 'wp-B', dependsOnWorkPackageId: 'wp-A', type: 'finish_to_start' },
      ]
      const wpRepo = createMockWorkPackageRepo({
        getDependenciesByProject: vi.fn().mockResolvedValue(deps),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      const result = await service.getDependencies('proj-001')
      expect(result).toEqual(deps)
    })

    it('throws PROJECT_NOT_FOUND when project missing', async () => {
      const wpRepo = createMockWorkPackageRepo()
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new WorkPackageService(wpRepo as never, projRepo as never)

      await expect(service.getDependencies('nonexistent')).rejects.toThrow('Project not found')
    })
  })
})

// ── MilestoneService tests ──

describe('MilestoneService', () => {
  describe('updateMilestoneStatus', () => {
    it('allows pending -> in_progress', async () => {
      const milestone = makeMilestone({ status: 'pending' })
      const updated = makeMilestone({ status: 'in_progress' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'in_progress')
      expect(result).toBeDefined()
      expect(result?.status).toBe('in_progress')
    })

    it('allows in_progress -> submitted', async () => {
      const milestone = makeMilestone({ status: 'in_progress' })
      const updated = makeMilestone({ status: 'submitted' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'submitted')
      expect(result).toBeDefined()
      expect(result?.status).toBe('submitted')
    })

    it('allows submitted -> approved', async () => {
      const milestone = makeMilestone({ status: 'submitted' })
      const updated = makeMilestone({ status: 'approved' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'approved')
      expect(result).toBeDefined()
      expect(result?.status).toBe('approved')
    })

    it('allows submitted -> revision_requested (within free limit)', async () => {
      const milestone = makeMilestone({ status: 'submitted', revisionCount: 0 })
      const updated = makeMilestone({ status: 'revision_requested', revisionCount: 1 })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        incrementRevisionCount: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'revision_requested')
      expect(result).toBeDefined()
      expect(result?.status).toBe('revision_requested')
      expect(msRepo.incrementRevisionCount).toHaveBeenCalledWith('ms-001')
    })

    it('allows submitted -> rejected', async () => {
      const milestone = makeMilestone({ status: 'submitted' })
      const updated = makeMilestone({ status: 'rejected' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'rejected')
      expect(result).toBeDefined()
      expect(result?.status).toBe('rejected')
    })

    it('allows revision_requested -> in_progress', async () => {
      const milestone = makeMilestone({ status: 'revision_requested', revisionCount: 1 })
      const updated = makeMilestone({ status: 'in_progress', revisionCount: 1 })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        updateStatus: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'in_progress')
      expect(result).toBeDefined()
      expect(result?.status).toBe('in_progress')
    })

    it('rejects approved -> pending (no backward)', async () => {
      const milestone = makeMilestone({ status: 'approved' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.updateMilestoneStatus('ms-001', 'pending')).rejects.toThrow(AppError)

      try {
        await service.updateMilestoneStatus('ms-001', 'pending')
      } catch (err) {
        const appErr = err as AppError
        expect(appErr.code).toBe('MILESTONE_INVALID_STATUS')
        expect(appErr.message).toContain('approved')
        expect(appErr.message).toContain('pending')
        expect(appErr.message).toContain('Valid targets: none')
      }
    })

    it('rejects rejected -> in_progress (no transitions from rejected)', async () => {
      const milestone = makeMilestone({ status: 'rejected' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.updateMilestoneStatus('ms-001', 'in_progress')).rejects.toThrow(AppError)
    })

    it('rejects pending -> submitted (must go through in_progress)', async () => {
      const milestone = makeMilestone({ status: 'pending' })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.updateMilestoneStatus('ms-001', 'submitted')).rejects.toThrow(AppError)

      try {
        await service.updateMilestoneStatus('ms-001', 'submitted')
      } catch (err) {
        const appErr = err as AppError
        expect(appErr.code).toBe('MILESTONE_INVALID_STATUS')
        expect(appErr.message).toContain('Valid targets: in_progress')
      }
    })

    it('enforces free revision limit', async () => {
      const milestone = makeMilestone({
        status: 'submitted',
        revisionCount: FREE_REVISION_ROUNDS, // Already at limit (2)
      })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.updateMilestoneStatus('ms-001', 'revision_requested')).rejects.toThrow(
        AppError,
      )

      try {
        await service.updateMilestoneStatus('ms-001', 'revision_requested')
      } catch (err) {
        const appErr = err as AppError
        expect(appErr.code).toBe('MILESTONE_REVISION_LIMIT')
        expect(appErr.message).toContain(`${FREE_REVISION_ROUNDS}`)
      }
    })

    it('allows revision when under free limit', async () => {
      const milestone = makeMilestone({
        status: 'submitted',
        revisionCount: 1, // 1 < FREE_REVISION_ROUNDS (2)
      })
      const updated = makeMilestone({ status: 'revision_requested', revisionCount: 2 })
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        incrementRevisionCount: vi.fn().mockResolvedValue(updated),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.updateMilestoneStatus('ms-001', 'revision_requested')
      expect(result).toBeDefined()
      expect(result?.revisionCount).toBe(2)
    })

    it('throws MILESTONE_NOT_FOUND for missing milestone', async () => {
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.updateMilestoneStatus('nonexistent', 'in_progress')).rejects.toThrow(
        'Milestone not found',
      )
    })
  })

  describe('createMilestone', () => {
    it('creates milestone with valid input', async () => {
      const created = makeMilestone()
      const msRepo = createMockMilestoneRepo({
        create: vi.fn().mockResolvedValue(created),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.createMilestone({
        projectId: 'proj-001',
        title: 'Milestone 1',
        description: 'First milestone',
        orderIndex: 0,
        amount: 1_000_000,
        dueDate: '2026-04-30',
      })

      expect(result).toEqual(created)
      expect(msRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          revisionCount: 0,
          milestoneType: 'individual',
        }),
      )
    })

    it('throws if project not found', async () => {
      const msRepo = createMockMilestoneRepo()
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(
        service.createMilestone({
          projectId: 'nonexistent',
          title: 'Milestone 1',
          description: 'First milestone',
          orderIndex: 0,
          amount: 1_000_000,
          dueDate: '2026-04-30',
        }),
      ).rejects.toThrow('Project not found')
    })

    it('defaults milestoneType to individual', async () => {
      const msRepo = createMockMilestoneRepo({
        create: vi.fn().mockResolvedValue(makeMilestone()),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await service.createMilestone({
        projectId: 'proj-001',
        title: 'Test',
        description: 'Test',
        orderIndex: 0,
        amount: 500_000,
        dueDate: '2026-05-01',
      })

      expect(msRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ milestoneType: 'individual' }),
      )
    })

    it('accepts integration milestoneType', async () => {
      const msRepo = createMockMilestoneRepo({
        create: vi.fn().mockResolvedValue(makeMilestone({ milestoneType: 'integration' })),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await service.createMilestone({
        projectId: 'proj-001',
        title: 'Integration Milestone',
        description: 'Integration test',
        milestoneType: 'integration',
        orderIndex: 0,
        amount: 1_000_000,
        dueDate: '2026-05-01',
      })

      expect(msRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ milestoneType: 'integration' }),
      )
    })
  })

  describe('getMilestone', () => {
    it('returns milestone when found', async () => {
      const milestone = makeMilestone()
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.getMilestone('ms-001')
      expect(result).toEqual(milestone)
    })

    it('throws when milestone not found', async () => {
      const msRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const projRepo = createMockProjectRepo()
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.getMilestone('nonexistent')).rejects.toThrow('Milestone not found')
    })
  })

  describe('listByProject', () => {
    it('returns milestones for existing project', async () => {
      const milestones = [makeMilestone(), makeMilestone({ id: 'ms-002' })]
      const msRepo = createMockMilestoneRepo({
        findByProjectId: vi.fn().mockResolvedValue(milestones),
      })
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(makeProject()),
      })
      const service = new MilestoneService(msRepo as never, projRepo as never)

      const result = await service.listByProject('proj-001')
      expect(result).toHaveLength(2)
      expect(msRepo.findByProjectId).toHaveBeenCalledWith('proj-001')
    })

    it('throws PROJECT_NOT_FOUND when project missing', async () => {
      const msRepo = createMockMilestoneRepo()
      const projRepo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new MilestoneService(msRepo as never, projRepo as never)

      await expect(service.listByProject('nonexistent')).rejects.toThrow('Project not found')
    })
  })
})
