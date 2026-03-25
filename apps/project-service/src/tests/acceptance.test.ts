import {
  AppError,
  createProjectSchema,
  EXPLORATION_RATE,
  FREE_MILESTONE_REVISIONS,
  MATCHING_WEIGHTS,
  NEW_TALENT_DEFAULTS,
  type ProjectStatus,
} from '@kerjacus/shared'
import { describe, expect, it, vi } from 'vitest'
import { isValidTransition, validateTransitionViaXState } from '../lib/state-machine'
import { MatchingService } from '../services/matching.service'
import { MilestoneService } from '../services/milestone.service'
import { ProjectService } from '../services/project.service'

// ── Test helpers ──

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-001',
    ownerId: 'owner-001',
    title: 'Test Project',
    description: 'A test project for acceptance testing',
    category: 'web_app',
    status: 'draft',
    budgetMin: 5_000_000,
    budgetMax: 20_000_000,
    estimatedTimelineDays: 60,
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

function makeMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ms-001',
    projectId: 'proj-001',
    workPackageId: null,
    assignedTalentId: 'talent-001',
    title: 'Milestone 1',
    description: 'First milestone',
    milestoneType: 'individual',
    orderIndex: 0,
    amount: 2_000_000,
    status: 'pending',
    revisionCount: 0,
    dueDate: new Date('2025-06-01'),
    submittedAt: null,
    completedAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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

function createMockMatchingRepo(overrides: Record<string, unknown> = {}) {
  return {
    findEligibleTalents: vi.fn().mockResolvedValue([]),
    getTalentSkills: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

// ── ATDD: Project Creation Flow ──

describe('ATDD: Project Creation Flow', () => {
  it('As an owner, I can create a project with title and category', async () => {
    const input = {
      title: 'E-commerce Platform',
      description: 'A modern e-commerce platform with cart, checkout, and payment',
      category: 'web_app' as const,
      budgetMin: 10_000_000,
      budgetMax: 50_000_000,
      estimatedTimelineDays: 90,
    }

    // Schema validation passes
    const parsed = createProjectSchema.safeParse(input)
    expect(parsed.success).toBe(true)

    // Service creates project with draft status
    const project = makeProject(input)
    const repo = createMockProjectRepo({
      create: vi.fn().mockResolvedValue(project),
    })
    const service = new ProjectService(repo as never)

    if (!parsed.data) throw new Error('Validation failed')
    const result = await service.createProject('owner-001', parsed.data)
    expect(result.status).toBe('draft')
    expect(result.title).toBe('E-commerce Platform')
  })

  it('As an owner with specs, I can attach a document URL to the project', () => {
    const input = {
      title: 'Mobile Banking App',
      description: 'A banking app with transfers and bill payment',
      category: 'mobile_app' as const,
      budgetMin: 50_000_000,
      budgetMax: 100_000_000,
      estimatedTimelineDays: 120,
      documentFileUrl: 'documents/brd-mobile-banking.pdf',
    }

    const parsed = createProjectSchema.safeParse(input)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.documentFileUrl).toBe('documents/brd-mobile-banking.pdf')
    }
  })

  it('As an owner without specs, I go through AI scoping (project starts as draft)', async () => {
    const input = {
      title: 'Some Idea',
      description: 'I have an idea for an app but no detailed specs yet',
      category: 'web_app' as const,
      budgetMin: 0,
      budgetMax: 0,
      estimatedTimelineDays: 60,
    }

    const parsed = createProjectSchema.safeParse(input)
    expect(parsed.success).toBe(true)

    // Project is created as draft, then transitions to scoping for AI chatbot
    const draftProject = makeProject({ ...input, status: 'draft' })
    const scopingProject = makeProject({ ...input, status: 'scoping' })
    const repo = createMockProjectRepo({
      create: vi.fn().mockResolvedValue(draftProject),
      findById: vi.fn().mockResolvedValue(draftProject),
      updateStatus: vi.fn().mockResolvedValue(scopingProject),
    })
    const service = new ProjectService(repo as never)

    if (!parsed.data) throw new Error('Validation failed')
    const created = await service.createProject('owner-001', parsed.data)
    expect(created.status).toBe('draft')

    // Transition to scoping for AI chatbot flow
    const scoped = await service.transitionStatus('proj-001', 'scoping', 'owner-001')
    expect(scoped.status).toBe('scoping')
  })

  it('As an owner, budgetMax must be greater than budgetMin', () => {
    const invalidInput = {
      title: 'Test',
      description: 'A test project with invalid budget',
      category: 'web_app' as const,
      budgetMin: 50_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 30,
    }

    // Schema accepts it (individual fields valid), but service rejects
    const parsed = createProjectSchema.safeParse(invalidInput)
    expect(parsed.success).toBe(true)

    // Service layer validates budget order
    const repo = createMockProjectRepo()
    const service = new ProjectService(repo as never)

    if (!parsed.data) throw new Error('Validation failed')
    expect(service.createProject('owner-001', parsed.data)).rejects.toThrow(AppError)
  })

  it('As an owner, project title must be at least 3 characters', () => {
    const input = {
      title: 'AB',
      description: 'A proper description here',
      category: 'web_app' as const,
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
    }

    const result = createProjectSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// ── ATDD: Project Lifecycle Flow ──

describe('ATDD: Project Lifecycle Flow', () => {
  it('As an owner, my project follows the correct lifecycle path', () => {
    const happyPath: [ProjectStatus, ProjectStatus][] = [
      ['draft', 'scoping'],
      ['scoping', 'brd_generated'],
      ['brd_generated', 'brd_approved'],
      ['brd_approved', 'prd_generated'],
      ['prd_generated', 'prd_approved'],
      ['prd_approved', 'matching'],
      ['matching', 'matched'],
      ['matched', 'in_progress'],
      ['in_progress', 'review'],
      ['review', 'completed'],
    ]

    for (const [from, to] of happyPath) {
      expect(isValidTransition(from, to), `Expected ${from} -> ${to} to be valid`).toBe(true)
    }
  })

  it('As an owner, I can cancel a project before it starts', () => {
    const cancellableStatuses: ProjectStatus[] = [
      'draft',
      'scoping',
      'brd_generated',
      'brd_approved',
      'prd_generated',
      'prd_approved',
      'matching',
      'team_forming',
      'matched',
    ]

    for (const status of cancellableStatuses) {
      expect(
        isValidTransition(status, 'cancelled'),
        `Expected ${status} -> cancelled to be valid`,
      ).toBe(true)
    }
  })

  it('As a user, completed projects cannot be modified', () => {
    const finalStatuses: ProjectStatus[] = [
      'completed',
      'cancelled',
      'brd_purchased',
      'prd_purchased',
    ]

    for (const status of finalStatuses) {
      expect(isValidTransition(status, 'draft'), `Expected ${status} -> draft to be invalid`).toBe(
        false,
      )
    }
  })

  it('As an admin, disputed projects can be resolved to multiple states', () => {
    const disputeResolutions: ProjectStatus[] = ['in_progress', 'cancelled', 'completed']

    for (const target of disputeResolutions) {
      const result = validateTransitionViaXState('disputed', target)
      expect(result.valid, `Expected disputed -> ${target} to be valid`).toBe(true)
    }
  })
})

// ── ATDD: Milestone Management Flow ──

describe('ATDD: Milestone Management Flow', () => {
  it('As a talent, I can progress a milestone from pending to submitted', async () => {
    const pendingMilestone = makeMilestone({ status: 'pending' })
    const inProgressMilestone = makeMilestone({ status: 'in_progress' })
    const submittedMilestone = makeMilestone({ status: 'submitted' })

    const milestoneRepo = createMockMilestoneRepo({
      findById: vi
        .fn()
        .mockResolvedValueOnce(pendingMilestone)
        .mockResolvedValueOnce(inProgressMilestone),
      updateStatus: vi
        .fn()
        .mockResolvedValueOnce(inProgressMilestone)
        .mockResolvedValueOnce(submittedMilestone),
    })
    const projectRepo = createMockProjectRepo()
    const service = new MilestoneService(milestoneRepo as never, projectRepo as never)

    const step1 = await service.updateMilestoneStatus('ms-001', 'in_progress')
    expect(step1).toBeDefined()
    expect(step1?.status).toBe('in_progress')

    const step2 = await service.updateMilestoneStatus('ms-001', 'submitted')
    expect(step2).toBeDefined()
    expect(step2?.status).toBe('submitted')
  })

  it('As an owner, I can request up to 2 free revisions per milestone', async () => {
    // First revision
    const milestone0 = makeMilestone({ status: 'submitted', revisionCount: 0 })
    const milestone1 = makeMilestone({ status: 'revision_requested', revisionCount: 1 })
    const milestone1submitted = makeMilestone({ status: 'submitted', revisionCount: 1 })
    const milestone2 = makeMilestone({ status: 'revision_requested', revisionCount: 2 })

    const milestoneRepo = createMockMilestoneRepo({
      findById: vi
        .fn()
        .mockResolvedValueOnce(milestone0)
        .mockResolvedValueOnce(milestone1submitted),
      incrementRevisionCount: vi
        .fn()
        .mockResolvedValueOnce(milestone1)
        .mockResolvedValueOnce(milestone2),
    })
    const projectRepo = createMockProjectRepo()
    const service = new MilestoneService(milestoneRepo as never, projectRepo as never)

    const rev1 = await service.updateMilestoneStatus('ms-001', 'revision_requested')
    expect(rev1).toBeDefined()
    expect(rev1?.revisionCount).toBe(1)

    const rev2 = await service.updateMilestoneStatus('ms-001', 'revision_requested')
    expect(rev2).toBeDefined()
    expect(rev2?.revisionCount).toBe(2)
  })

  it('As an owner, the 3rd revision should be rejected (paid revision required)', async () => {
    const milestone = makeMilestone({
      status: 'submitted',
      revisionCount: FREE_MILESTONE_REVISIONS,
    })

    const milestoneRepo = createMockMilestoneRepo({
      findById: vi.fn().mockResolvedValue(milestone),
    })
    const projectRepo = createMockProjectRepo()
    const service = new MilestoneService(milestoneRepo as never, projectRepo as never)

    await expect(service.updateMilestoneStatus('ms-001', 'revision_requested')).rejects.toThrow(
      AppError,
    )
  })
})

// ── ATDD: Matching Flow ──

describe('ATDD: Matching Flow', () => {
  it('As a talent, my skills are matched against project requirements', async () => {
    const talents = [
      {
        id: 'talent-001',
        userId: 'user-001',
        totalProjectsActive: 0,
        totalProjectsCompleted: 5,
        pemerataanPenalty: 0,
        averageRating: 4.5,
      },
      {
        id: 'talent-002',
        userId: 'user-002',
        totalProjectsActive: 1,
        totalProjectsCompleted: 2,
        pemerataanPenalty: 0,
        averageRating: 3.8,
      },
    ]

    const skills = [
      { talentId: 'talent-001', skillName: 'React' },
      { talentId: 'talent-001', skillName: 'TypeScript' },
      { talentId: 'talent-002', skillName: 'Node.js' },
      { talentId: 'talent-002', skillName: 'Python' },
    ]

    const repo = createMockMatchingRepo({
      findEligibleTalents: vi.fn().mockResolvedValue(talents),
      getTalentSkills: vi.fn().mockResolvedValue(skills),
    })

    const service = new MatchingService(repo as never)
    const result = await service.matchTalentsToProject(['React', 'TypeScript'], [], 5)

    expect(result.recommendations.length).toBeGreaterThan(0)

    // Talent-001 has matching skills and should score higher on skill_match
    const talent1 = result.recommendations.find((r) => r.talentId === 'talent-001')
    const talent2 = result.recommendations.find((r) => r.talentId === 'talent-002')

    expect(talent1).toBeDefined()
    expect(talent1?.skillMatch).toBe(1.0) // Both skills match
    expect(talent2?.skillMatch ?? 0).toBe(0) // No matching skills
  })

  it('New talents get exploration boost in matching', async () => {
    const talents = [
      {
        id: 'new-talent',
        userId: 'user-new',
        totalProjectsActive: 0,
        totalProjectsCompleted: 0, // new talent
        pemerataanPenalty: 0,
        averageRating: null,
      },
      {
        id: 'veteran-talent',
        userId: 'user-vet',
        totalProjectsActive: 2,
        totalProjectsCompleted: 10,
        pemerataanPenalty: 0,
        averageRating: 4.0,
      },
    ]

    const skills = [
      { talentId: 'new-talent', skillName: 'React' },
      { talentId: 'veteran-talent', skillName: 'React' },
    ]

    const repo = createMockMatchingRepo({
      findEligibleTalents: vi.fn().mockResolvedValue(talents),
      getTalentSkills: vi.fn().mockResolvedValue(skills),
    })

    const service = new MatchingService(repo as never)
    const result = await service.matchTalentsToProject(['React'], [], 10)

    expect(result.recommendations.length).toBe(2)

    const newTalent = result.recommendations.find((r) => r.talentId === 'new-talent')
    expect(newTalent).toBeDefined()

    // New talent gets pemerataan bonus of +0.2 and default rating of 0.7
    expect(newTalent?.pemerataanScore).toBe(1.0) // 1 / (1 + 0) = 1.0
    expect(newTalent?.rating).toBe(NEW_TALENT_DEFAULTS.RATING)
    expect(newTalent?.trackRecord).toBe(NEW_TALENT_DEFAULTS.TRACK_RECORD)
  })

  it('Exploration rate allocates 30% of slots for underrepresented talents', async () => {
    // Create a pool of 10 talents, some with many projects, some new
    const talents = Array.from({ length: 10 }, (_, i) => ({
      id: `talent-${i}`,
      userId: `user-${i}`,
      totalProjectsActive: i < 3 ? 0 : 2,
      totalProjectsCompleted: i < 3 ? 0 : 10 + i,
      pemerataanPenalty: 0,
      averageRating: i < 3 ? null : 4.0,
    }))

    const skills = talents.map((t) => ({
      talentId: t.id,
      skillName: 'JavaScript',
    }))

    const repo = createMockMatchingRepo({
      findEligibleTalents: vi.fn().mockResolvedValue(talents),
      getTalentSkills: vi.fn().mockResolvedValue(skills),
    })

    const service = new MatchingService(repo as never)
    const limit = 10
    const result = await service.matchTalentsToProject(['JavaScript'], [], limit)

    // Exploration should be ~30% of limit
    const expectedExploration = Math.ceil(limit * EXPLORATION_RATE)
    expect(result.explorationCount).toBeLessThanOrEqual(expectedExploration)
    expect(result.exploitationCount).toBeGreaterThan(0)
  })

  it('Matching weights sum to 1.0 for balanced scoring', () => {
    const totalWeight =
      MATCHING_WEIGHTS.SKILL_MATCH +
      MATCHING_WEIGHTS.PEMERATAAN +
      MATCHING_WEIGHTS.TRACK_RECORD +
      MATCHING_WEIGHTS.RATING

    expect(totalWeight).toBeCloseTo(1.0)
  })
})
