import { describe, expect, it } from 'vitest'
import {
  createTestId,
  createTestMilestone,
  createTestProject,
  createTestTransaction,
  createTestUser,
  createTestWorker,
} from './index'

describe('createTestId', () => {
  it('returns UUID-like string', () => {
    const id = createTestId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('returns unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createTestId()))
    expect(ids.size).toBe(100)
  })
})

describe('createTestUser', () => {
  it('has required fields', () => {
    const user = createTestUser()
    expect(user.id).toBeDefined()
    expect(user.email).toContain('@bytz.test')
    expect(user.name).toBe('Test User')
    expect(user.phone).toMatch(/^\+628/)
    expect(user.role).toBe('client')
    expect(user.isVerified).toBe(true)
    expect(user.phoneVerified).toBe(true)
    expect(user.locale).toBe('id')
  })

  it('accepts overrides', () => {
    const user = createTestUser({ role: 'worker', name: 'Custom' })
    expect(user.role).toBe('worker')
    expect(user.name).toBe('Custom')
  })

  it('generates unique emails', () => {
    const u1 = createTestUser()
    const u2 = createTestUser()
    expect(u1.email).not.toBe(u2.email)
  })

  it('generates unique IDs', () => {
    const u1 = createTestUser()
    const u2 = createTestUser()
    expect(u1.id).not.toBe(u2.id)
  })
})

describe('createTestWorker', () => {
  it('has required fields', () => {
    const worker = createTestWorker()
    expect(worker.id).toBeDefined()
    expect(worker.userId).toBeDefined()
    expect(worker.bio).toBe('Test worker bio')
    expect(worker.yearsOfExperience).toBe(3)
    expect(worker.tier).toBe('mid')
    expect(worker.availabilityStatus).toBe('available')
    expect(worker.verificationStatus).toBe('verified')
    expect(worker.totalProjectsCompleted).toBe(0)
    expect(worker.totalProjectsActive).toBe(0)
    expect(worker.averageRating).toBeNull()
    expect(worker.pemerataanPenalty).toBe(0)
  })

  it('accepts overrides', () => {
    const worker = createTestWorker({
      tier: 'senior',
      totalProjectsCompleted: 10,
    })
    expect(worker.tier).toBe('senior')
    expect(worker.totalProjectsCompleted).toBe(10)
  })
})

describe('createTestProject', () => {
  it('has defaults', () => {
    const project = createTestProject()
    expect(project.id).toBeDefined()
    expect(project.clientId).toBeDefined()
    expect(project.title).toBe('Test Project')
    expect(project.status).toBe('draft')
    expect(project.category).toBe('web_app')
    expect(project.budgetMin).toBeGreaterThan(0)
    expect(project.budgetMax).toBeGreaterThan(project.budgetMin)
    expect(project.estimatedTimelineDays).toBeGreaterThan(0)
    expect(project.teamSize).toBe(1)
  })

  it('accepts overrides', () => {
    const project = createTestProject({
      status: 'in_progress',
      teamSize: 3,
    })
    expect(project.status).toBe('in_progress')
    expect(project.teamSize).toBe(3)
  })
})

describe('createTestMilestone', () => {
  it('has defaults', () => {
    const ms = createTestMilestone()
    expect(ms.id).toBeDefined()
    expect(ms.projectId).toBeDefined()
    expect(ms.title).toBe('Test Milestone')
    expect(ms.status).toBe('pending')
    expect(ms.milestoneType).toBe('individual')
    expect(ms.amount).toBeGreaterThan(0)
    expect(ms.orderIndex).toBe(0)
    expect(ms.revisionCount).toBe(0)
  })

  it('accepts overrides', () => {
    const ms = createTestMilestone({
      status: 'approved',
      amount: 1000000,
    })
    expect(ms.status).toBe('approved')
    expect(ms.amount).toBe(1000000)
  })
})

describe('createTestTransaction', () => {
  it('has idempotency key', () => {
    const txn = createTestTransaction()
    expect(txn.idempotencyKey).toBeDefined()
    expect(txn.idempotencyKey.length).toBeGreaterThan(0)
  })

  it('has defaults', () => {
    const txn = createTestTransaction()
    expect(txn.id).toBeDefined()
    expect(txn.projectId).toBeDefined()
    expect(txn.type).toBe('escrow_in')
    expect(txn.amount).toBe(10000000)
    expect(txn.status).toBe('pending')
  })

  it('accepts overrides', () => {
    const txn = createTestTransaction({
      type: 'escrow_release',
      amount: 5000000,
    })
    expect(txn.type).toBe('escrow_release')
    expect(txn.amount).toBe(5000000)
  })

  it('generates unique idempotency keys', () => {
    const t1 = createTestTransaction()
    const t2 = createTestTransaction()
    expect(t1.idempotencyKey).not.toBe(t2.idempotencyKey)
  })
})
