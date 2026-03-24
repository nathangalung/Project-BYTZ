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
  // ── Scenario: Create a new project ──

  Scenario('Create a new project', ({ Given, When, Then }) => {
    let service: ProjectService
    let result: Record<string, unknown>
    let input: Record<string, unknown>

    Given('an owner wants to create a project', () => {
      const project = makeProject()
      const repo = createMockProjectRepo({
        create: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When(
      'they submit title {string} and category {string}',
      async (_ctx, title: string, category: string) => {
        input = {
          title,
          description: 'A full e-commerce application with cart and checkout',
          category,
          budgetMin: 5_000_000,
          budgetMax: 20_000_000,
          estimatedTimelineDays: 60,
        }

        // Validate schema first
        const parsed = createProjectSchema.safeParse(input)
        expect(parsed.success).toBe(true)

        result = await service.createProject('owner-001', parsed.data!)
      },
    )

    Then('the project should be created with status {string}', (_ctx, expectedStatus: string) => {
      expect(result).toBeDefined()
      expect(result.status).toBe(expectedStatus)
    })
  })

  // ── Scenario: Transition from draft to scoping ──

  Scenario('Transition from draft to scoping', ({ Given, When, Then }) => {
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

    When('the owner transitions to {string}', async (_ctx, targetStatus: string) => {
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

    Then('the status should be {string}', (_ctx, expectedStatus: string) => {
      expect(transitionError).toBeNull()
      expect(result.status).toBe(expectedStatus)
    })
  })

  // ── Scenario: Transition from scoping to brd_generated ──

  Scenario('Transition from scoping to brd_generated', ({ Given, When, Then }) => {
    let service: ProjectService
    let result: Record<string, unknown>
    let transitionError: Error | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const updatedProject = makeProject({ status: 'brd_generated' })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
        updateStatus: vi.fn().mockResolvedValue(updatedProject),
      })
      service = new ProjectService(repo as never)
    })

    When('the owner transitions to {string}', async (_ctx, targetStatus: string) => {
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

    Then('the status should be {string}', (_ctx, expectedStatus: string) => {
      expect(transitionError).toBeNull()
      expect(result.status).toBe(expectedStatus)
    })
  })

  // ── Scenario: Invalid transition is rejected ──

  Scenario('Invalid transition is rejected', ({ Given, When, Then }) => {
    let service: ProjectService
    let transitionError: AppError | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When('the owner transitions to {string}', async (_ctx, targetStatus: string) => {
      try {
        await service.transitionStatus('proj-001', targetStatus as ProjectStatus, 'owner-001')
      } catch (err) {
        transitionError = err as AppError
      }
    })

    Then('the transition should be rejected', () => {
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

    When('the owner transitions to {string}', async (_ctx, targetStatus: string) => {
      try {
        await service.transitionStatus('proj-001', targetStatus as ProjectStatus, 'owner-001')
      } catch (err) {
        transitionError = err as AppError
      }
    })

    Then('the transition should be rejected', () => {
      expect(transitionError).not.toBeNull()
      expect(transitionError).toBeInstanceOf(AppError)
      expect(transitionError?.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
    })
  })

  // ── Scenario: Team project requires team_forming ──

  Scenario('Team project requires team_forming', ({ Given, When, Then }) => {
    let isValid: boolean

    Given(
      'a project with team_size {int} in {string} status',
      (_ctx, teamSize: number, status: string) => {
        // Verify this is a valid team project setup
        expect(teamSize).toBeGreaterThan(1)
        expect(status).toBe('matching')
      },
    )

    When('the system transitions to {string}', (_ctx, targetStatus: string) => {
      // matching -> team_forming is valid for team projects
      isValid = isValidTransition('matching', targetStatus as ProjectStatus)
    })

    Then('the status should be {string}', (_ctx, expectedStatus: string) => {
      expect(isValid).toBe(true)
      expect(expectedStatus).toBe('team_forming')
    })
  })

  // ── Scenario: Cancelled project is final ──

  Scenario('Cancelled project is final', ({ Given, When, Then }) => {
    let service: ProjectService
    let transitionError: AppError | null = null

    Given('a project in {string} status', (_ctx, status: string) => {
      const project = makeProject({ status })
      const repo = createMockProjectRepo({
        findById: vi.fn().mockResolvedValue(project),
      })
      service = new ProjectService(repo as never)
    })

    When('the owner transitions to {string}', async (_ctx, targetStatus: string) => {
      try {
        await service.transitionStatus('proj-001', targetStatus as ProjectStatus, 'owner-001')
      } catch (err) {
        transitionError = err as AppError
      }
    })

    Then('the transition should be rejected', () => {
      expect(transitionError).not.toBeNull()
      expect(transitionError).toBeInstanceOf(AppError)
      expect(transitionError?.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
    })
  })

  // ── Scenario: Dispute can be resolved to continue ──

  Scenario('Dispute can be resolved to continue', ({ Given, When, Then }) => {
    let transitionResult: { valid: boolean; eventType: string | null }

    Given('a project in {string} status', (_ctx, status: string) => {
      expect(status).toBe('disputed')
    })

    When('the admin resolves dispute to continue', () => {
      transitionResult = validateTransitionViaXState('disputed', 'in_progress')
    })

    Then('the status should be {string}', (_ctx, expectedStatus: string) => {
      expect(transitionResult.valid).toBe(true)
      expect(expectedStatus).toBe('in_progress')
    })
  })
})
