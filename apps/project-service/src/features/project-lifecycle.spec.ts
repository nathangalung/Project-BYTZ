import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { AppError, createProjectSchema, type ProjectStatus } from '@kerjacus/shared'
import { expect, vi } from 'vitest'
import { isValidTransition, validateTransitionViaXState } from '../lib/state-machine'
import { ProjectService } from '../services/project.service'

const feature = await loadFeature('src/features/project-lifecycle.feature')

// ── Mock helpers ──

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

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-001',
    ownerId: 'owner-001',
    title: 'Test Project',
    description: 'A test project description here',
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

describeFeature(feature, ({ Scenario }) => {
  // ── Scenario: Create project with valid data ──

  Scenario('Create project with valid data', ({ Given, When, Then }) => {
    let service: ProjectService
    let result: Record<string, unknown>

    Given('a valid project creation payload', () => {
      const project = makeProject()
      const repo = createMockProjectRepo({
        create: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When('the project is created', async () => {
      const input = {
        title: 'E-commerce App',
        description: 'A full e-commerce application with cart and checkout',
        category: 'web_app' as const,
        budgetMin: 5_000_000,
        budgetMax: 20_000_000,
        estimatedTimelineDays: 60,
      }
      const parsed = createProjectSchema.safeParse(input)
      expect(parsed.success).toBe(true)
      if (!parsed.data) throw new Error('Schema validation failed')
      result = await service.createProject('owner-001', parsed.data)
    })

    Then('it should have status {string}', (_ctx, expectedStatus: string) => {
      expect(result).toBeDefined()
      expect(result.status).toBe(expectedStatus)
    })
  })

  // ── Scenario: Transition draft to scoping ──

  Scenario('Transition draft to scoping', ({ Given, When, Then }) => {
    let service: ProjectService
    let result: Record<string, unknown>
    let transitionError: Error | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const updatedProject = makeProject({ status: 'scoping' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updatedProject),
      })
      service = new ProjectService(repo as never)
    })

    When('transitioned to {string}', async (_ctx, targetStatus: string) => {
      try {
        result = await service.transitionStatus(
          'proj-001',
          targetStatus as ProjectStatus,
          'owner-001',
        )
      } catch (err) {
        transitionError = err as Error
      }
    })

    Then('the transition should succeed', () => {
      expect(transitionError).toBeNull()
      expect(result).toBeDefined()
    })
  })

  // ── Scenario: Transition from scoping to brd_review ──

  Scenario('Transition from scoping to brd_review', ({ Given, When, Then }) => {
    let service: ProjectService
    let result: Record<string, unknown>
    let transitionError: Error | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const updatedProject = makeProject({ status: 'brd_review' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updatedProject),
      })
      service = new ProjectService(repo as never)
    })

    When('transitioned to {string}', async (_ctx, targetStatus: string) => {
      try {
        result = await service.transitionStatus(
          'proj-001',
          targetStatus as ProjectStatus,
          'owner-001',
        )
      } catch (err) {
        transitionError = err as Error
      }
    })

    Then('the transition should succeed', () => {
      expect(transitionError).toBeNull()
      expect(result).toBeDefined()
    })
  })

  // ── Scenario: Invalid transition rejected ──

  Scenario('Invalid transition rejected', ({ Given, When, Then }) => {
    let service: ProjectService
    let transitionError: AppError | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When('transitioned to {string}', async (_ctx, targetStatus: string) => {
      try {
        await service.transitionStatus('proj-001', targetStatus as ProjectStatus, 'owner-001')
      } catch (err) {
        transitionError = err as AppError
      }
    })

    Then('the transition should fail', () => {
      expect(transitionError).not.toBeNull()
      expect(transitionError).toBeInstanceOf(AppError)
      expect(transitionError?.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
    })
  })

  // ── Scenario: Cannot skip from draft to in_progress ──

  Scenario('Cannot skip from draft to in_progress', ({ Given, When, Then }) => {
    let service: ProjectService
    let transitionError: AppError | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When('transitioned to {string}', async (_ctx, targetStatus: string) => {
      try {
        await service.transitionStatus('proj-001', targetStatus as ProjectStatus, 'owner-001')
      } catch (err) {
        transitionError = err as AppError
      }
    })

    Then('the transition should fail', () => {
      expect(transitionError).not.toBeNull()
      expect(transitionError).toBeInstanceOf(AppError)
      expect(transitionError?.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
    })
  })

  /**
   * team_forming and matched are gone, and so is the guard that used to keep a
   * team project from skipping one. A team is complete or it is not - a fact
   * about the work packages, checked where work starts - and the line itself
   * is what a project may not skip.
   */
  Scenario('A team project cannot skip past the work', ({ Given, When, Then }) => {
    let transitionResult: { valid: boolean }

    Given(
      'a project with team_size {int} in {string} status',
      (_ctx, teamSize: number, status: string) => {
        expect(teamSize).toBeGreaterThan(1)
        expect(status).toBe('matching')
      },
    )

    When('transitioned to {string}', (_ctx, targetStatus: string) => {
      transitionResult = { valid: isValidTransition('matching', targetStatus as ProjectStatus) }
    })

    Then('the transition should fail', () => {
      expect(transitionResult.valid).toBe(false)
    })
  })

  // ── Scenario: A team project starts work from matching ──

  Scenario('A team project starts work from matching', ({ Given, When, Then }) => {
    let isValid: boolean

    Given(
      'a project with team_size {int} in {string} status',
      (_ctx, teamSize: number, status: string) => {
        expect(teamSize).toBeGreaterThan(1)
        expect(status).toBe('matching')
      },
    )

    When('transitioned to {string}', (_ctx, targetStatus: string) => {
      isValid = isValidTransition('matching', targetStatus as ProjectStatus)
    })

    Then('the transition should succeed', () => {
      expect(isValid).toBe(true)
    })
  })

  // ── Scenario: Cancelled project cannot transition ──

  Scenario('Cancelled project cannot transition', ({ Given, When, Then }) => {
    let service: ProjectService
    let transitionError: AppError | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When('transitioned to {string}', async (_ctx, targetStatus: string) => {
      try {
        await service.transitionStatus('proj-001', targetStatus as ProjectStatus, 'owner-001')
      } catch (err) {
        transitionError = err as AppError
      }
    })

    Then('the transition should fail', () => {
      expect(transitionError).not.toBeNull()
      expect(transitionError).toBeInstanceOf(AppError)
      expect(transitionError?.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
    })
  })

  /**
   * A dispute froze the project by overwriting its status, so resolving one
   * had to pick somewhere to put it back. The dispute row is the freeze now
   * and the project never moved, so there is nothing to transition.
   */
  Scenario('Resolving a dispute is not a project transition', ({ Given, When, Then }) => {
    let transitionResult: { valid: boolean; eventType: string | null }

    Given('a project in {string} status', (_ctx, status: string) => {
      expect(status).toBe('disputed')
    })

    When('transitioned to {string}', (_ctx, targetStatus: string) => {
      transitionResult = validateTransitionViaXState(
        'disputed' as ProjectStatus,
        targetStatus as ProjectStatus,
      )
    })

    Then('the transition should fail', () => {
      expect(transitionResult.valid).toBe(false)
    })
  })
})
