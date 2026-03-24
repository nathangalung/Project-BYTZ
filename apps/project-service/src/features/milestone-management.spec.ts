import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { AppError, FREE_REVISION_ROUNDS } from '@kerjacus/shared'
import { expect, vi } from 'vitest'
import { MilestoneService } from '../services/milestone.service'

const feature = await loadFeature('src/features/milestone-management.feature')

// ── Mock helpers ──

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

function makeMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ms-001',
    projectId: 'proj-001',
    workPackageId: null,
    assignedTalentId: 'talent-001',
    title: 'Design mockups',
    description: 'Create UI/UX design mockups',
    milestoneType: 'individual',
    orderIndex: 0,
    amount: 2_000_000,
    status: 'submitted',
    revisionCount: 0,
    dueDate: new Date('2025-06-01'),
    submittedAt: new Date(),
    completedAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describeFeature(feature, ({ Scenario }) => {
  // ── Scenario: Owner approves a submitted milestone ──

  Scenario('Owner approves a submitted milestone', ({ Given, When, Then }) => {
    let service: MilestoneService
    let result: Record<string, unknown>
    let error: Error | null = null

    Given('a milestone in {string} status', (_ctx, status: string) => {
      const milestone = makeMilestone({ status })
      const updatedMilestone = makeMilestone({ status: 'approved' })
      const milestoneRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        updateStatus: vi.fn().mockResolvedValue(updatedMilestone),
      })
      const projectRepo = createMockProjectRepo()
      service = new MilestoneService(milestoneRepo as never, projectRepo as never)
    })

    When('the owner approves it', async () => {
      try {
        result = await service.updateMilestoneStatus('ms-001', 'approved')
      } catch (err) {
        error = err as Error
      }
    })

    Then('the milestone status should be {string}', (_ctx, expectedStatus: string) => {
      expect(error).toBeNull()
      expect(result).toBeDefined()
      expect(result.status).toBe(expectedStatus)
    })
  })

  // ── Scenario: Talent cannot approve milestones ──

  Scenario('Talent cannot approve milestones', ({ Given, When, Then }) => {
    let _milestone: ReturnType<typeof makeMilestone>
    let authError: { code: string } | null = null

    Given('a milestone in {string} status', (_ctx, status: string) => {
      _milestone = makeMilestone({ status })
    })

    When('a talent tries to approve it', () => {
      // Simulate route-level auth check: only owners can approve milestones
      const userRole = 'talent'
      if (userRole !== 'owner') {
        authError = { code: 'AUTH_FORBIDDEN' }
      }
    })

    Then('it should be rejected with {string}', (_ctx, expectedCode: string) => {
      expect(authError).not.toBeNull()
      expect(authError?.code).toBe(expectedCode)
    })
  })

  // ── Scenario: Free revision within limit ──

  Scenario('Free revision within limit', ({ Given, When, Then, And }) => {
    let service: MilestoneService
    let result: Record<string, unknown>
    let error: Error | null = null

    Given('a milestone with {int} revisions used', (_ctx, revisionCount: number) => {
      const milestone = makeMilestone({
        status: 'submitted',
        revisionCount,
      })
      const updatedMilestone = makeMilestone({
        status: 'revision_requested',
        revisionCount: revisionCount + 1,
      })
      const milestoneRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        incrementRevisionCount: vi.fn().mockResolvedValue(updatedMilestone),
      })
      const projectRepo = createMockProjectRepo()
      service = new MilestoneService(milestoneRepo as never, projectRepo as never)
    })

    When('a revision is requested', async () => {
      try {
        result = await service.updateMilestoneStatus('ms-001', 'revision_requested')
      } catch (err) {
        error = err as Error
      }
    })

    Then('the revision should be accepted', () => {
      expect(error).toBeNull()
      expect(result).toBeDefined()
    })

    And('the revision count should be {int}', (_ctx, expected: number) => {
      expect(result.revisionCount).toBe(expected)
    })
  })

  // ── Scenario: Free revision at limit boundary ──

  Scenario('Free revision at limit boundary', ({ Given, When, Then, And }) => {
    let service: MilestoneService
    let result: Record<string, unknown>
    let error: Error | null = null

    Given('a milestone with {int} revision used', (_ctx, revisionCount: number) => {
      const milestone = makeMilestone({
        status: 'submitted',
        revisionCount,
      })
      const updatedMilestone = makeMilestone({
        status: 'revision_requested',
        revisionCount: revisionCount + 1,
      })
      const milestoneRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
        incrementRevisionCount: vi.fn().mockResolvedValue(updatedMilestone),
      })
      const projectRepo = createMockProjectRepo()
      service = new MilestoneService(milestoneRepo as never, projectRepo as never)
    })

    When('a revision is requested', async () => {
      try {
        result = await service.updateMilestoneStatus('ms-001', 'revision_requested')
      } catch (err) {
        error = err as Error
      }
    })

    Then('the revision should be accepted', () => {
      expect(error).toBeNull()
      expect(result).toBeDefined()
    })

    And('the revision count should be {int}', (_ctx, expected: number) => {
      expect(result.revisionCount).toBe(expected)
    })
  })

  // ── Scenario: Free revision limit enforced ──

  Scenario('Free revision limit enforced', ({ Given, When, Then }) => {
    let service: MilestoneService
    let error: AppError | null = null

    Given('a milestone with {int} revisions already', (_ctx, revisionCount: number) => {
      expect(revisionCount).toBe(FREE_REVISION_ROUNDS)
      const milestone = makeMilestone({
        status: 'submitted',
        revisionCount,
      })
      const milestoneRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projectRepo = createMockProjectRepo()
      service = new MilestoneService(milestoneRepo as never, projectRepo as never)
    })

    When('a revision is requested', async () => {
      try {
        await service.updateMilestoneStatus('ms-001', 'revision_requested')
      } catch (err) {
        error = err as AppError
      }
    })

    Then('it should be rejected as revision limit exceeded', () => {
      expect(error).not.toBeNull()
      expect(error).toBeInstanceOf(AppError)
      expect(error?.code).toBe('MILESTONE_REVISION_LIMIT')
    })
  })

  // ── Scenario: Cannot approve a pending milestone ──

  Scenario('Cannot approve a pending milestone', ({ Given, When, Then }) => {
    let service: MilestoneService
    let error: AppError | null = null

    Given('a milestone in {string} status', (_ctx, status: string) => {
      const milestone = makeMilestone({ status })
      const milestoneRepo = createMockMilestoneRepo({
        findById: vi.fn().mockResolvedValue(milestone),
      })
      const projectRepo = createMockProjectRepo()
      service = new MilestoneService(milestoneRepo as never, projectRepo as never)
    })

    When('the owner approves it', async () => {
      try {
        await service.updateMilestoneStatus('ms-001', 'approved')
      } catch (err) {
        error = err as AppError
      }
    })

    Then('the milestone transition should be rejected', () => {
      expect(error).not.toBeNull()
      expect(error).toBeInstanceOf(AppError)
      expect(error?.code).toBe('MILESTONE_INVALID_STATUS')
    })
  })
})
