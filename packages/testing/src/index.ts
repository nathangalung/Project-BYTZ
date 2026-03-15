import { uuidv7 } from 'uuidv7'

export function createTestId(): string {
  return uuidv7()
}

export function createTestUser(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    email: `test-${uuidv7()}@bytz.test`,
    name: 'Test User',
    phone: `+6281${Math.floor(100000000 + Math.random() * 900000000)}`,
    role: 'client' as const,
    isVerified: true,
    phoneVerified: true,
    locale: 'id' as const,
    ...overrides,
  }
}

export function createTestWorker(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    userId: uuidv7(),
    bio: 'Test worker bio',
    yearsOfExperience: 3,
    tier: 'mid' as const,
    availabilityStatus: 'available' as const,
    verificationStatus: 'verified' as const,
    totalProjectsCompleted: 0,
    totalProjectsActive: 0,
    averageRating: null,
    pemerataanPenalty: 0,
    ...overrides,
  }
}

export function createTestProject(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    clientId: uuidv7(),
    title: 'Test Project',
    description: 'Test project description for testing purposes',
    category: 'web_app' as const,
    status: 'draft' as const,
    budgetMin: 10000000,
    budgetMax: 50000000,
    estimatedTimelineDays: 30,
    teamSize: 1,
    ...overrides,
  }
}

export function createTestMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    projectId: uuidv7(),
    title: 'Test Milestone',
    description: 'Test milestone description',
    milestoneType: 'individual' as const,
    orderIndex: 0,
    amount: 5000000,
    status: 'pending' as const,
    revisionCount: 0,
    ...overrides,
  }
}

export function createTestTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    projectId: uuidv7(),
    type: 'escrow_in' as const,
    amount: 10000000,
    status: 'pending' as const,
    idempotencyKey: uuidv7(),
    ...overrides,
  }
}
