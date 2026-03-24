import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  apiResponseSchema,
  createDisputeSchema,
  createProjectSchema,
  createReviewSchema,
  createRevisionRequestSchema,
  createTimeLogSchema,
  idParamSchema,
  indonesianPhoneSchema,
  loginSchema,
  paginatedResponseSchema,
  paginationSchema,
  registerTalentSchema,
  registerUserSchema,
  requestOtpSchema,
  sendChatMessageSchema,
  submitMilestoneSchema,
  verifyPhoneSchema,
} from './schemas'

describe('indonesianPhoneSchema', () => {
  it('accepts valid +62 numbers', () => {
    expect(indonesianPhoneSchema.safeParse('+6281234567890').success).toBe(true)
    expect(indonesianPhoneSchema.safeParse('+628123456789').success).toBe(true)
    expect(indonesianPhoneSchema.safeParse('+62812345678901').success).toBe(true)
  })

  it('rejects invalid formats', () => {
    expect(indonesianPhoneSchema.safeParse('081234567890').success).toBe(false)
    expect(indonesianPhoneSchema.safeParse('+6212345').success).toBe(false)
    expect(indonesianPhoneSchema.safeParse('+1234567890').success).toBe(false)
    expect(indonesianPhoneSchema.safeParse('').success).toBe(false)
    expect(indonesianPhoneSchema.safeParse('+62abc').success).toBe(false)
  })
})

describe('registerUserSchema', () => {
  it('validates complete registration', () => {
    const result = registerUserSchema.safeParse({
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
      phone: '+6281234567890',
      role: 'owner',
    })
    expect(result.success).toBe(true)
  })

  it('accepts talent role', () => {
    const result = registerUserSchema.safeParse({
      name: 'Talent',
      email: 'talent@example.com',
      password: 'Password123!',
      phone: '+6281234567890',
      role: 'talent',
    })
    expect(result.success).toBe(true)
  })

  it('rejects short password', () => {
    const result = registerUserSchema.safeParse({
      name: 'Test',
      email: 'test@example.com',
      password: 'short',
      phone: '+6281234567890',
      role: 'owner',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = registerUserSchema.safeParse({
      name: 'Test',
      email: 'not-an-email',
      password: 'Password123!',
      phone: '+6281234567890',
      role: 'owner',
    })
    expect(result.success).toBe(false)
  })

  it('rejects short name', () => {
    const result = registerUserSchema.safeParse({
      name: 'A',
      email: 'test@example.com',
      password: 'Password123!',
      phone: '+6281234567890',
      role: 'owner',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid role', () => {
    const result = registerUserSchema.safeParse({
      name: 'Test',
      email: 'test@example.com',
      password: 'Password123!',
      phone: '+6281234567890',
      role: 'admin',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('validates correct login', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'password',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('createProjectSchema', () => {
  it('validates project creation', () => {
    const result = createProjectSchema.safeParse({
      title: 'My Project',
      description: 'A test project description',
      category: 'web_app',
      budgetMin: 5000000,
      budgetMax: 50000000,
      estimatedTimelineDays: 30,
    })
    expect(result.success).toBe(true)
  })

  it('accepts all categories', () => {
    for (const cat of ['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital']) {
      const result = createProjectSchema.safeParse({
        title: 'Test',
        description: 'Long enough desc',
        category: cat,
        budgetMin: 0,
        budgetMax: 100,
        estimatedTimelineDays: 1,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid category', () => {
    const result = createProjectSchema.safeParse({
      title: 'My Project',
      description: 'A test project description',
      category: 'invalid',
      budgetMin: 5000000,
      budgetMax: 50000000,
      estimatedTimelineDays: 30,
    })
    expect(result.success).toBe(false)
  })

  it('rejects short title', () => {
    const result = createProjectSchema.safeParse({
      title: 'Ab',
      description: 'A test project description',
      category: 'web_app',
      budgetMin: 0,
      budgetMax: 100,
      estimatedTimelineDays: 1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects short description', () => {
    const result = createProjectSchema.safeParse({
      title: 'My Project',
      description: 'Short',
      category: 'web_app',
      budgetMin: 0,
      budgetMax: 100,
      estimatedTimelineDays: 1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative budget', () => {
    const result = createProjectSchema.safeParse({
      title: 'My Project',
      description: 'A test project description',
      category: 'web_app',
      budgetMin: -1,
      budgetMax: 100,
      estimatedTimelineDays: 1,
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional preferences', () => {
    const result = createProjectSchema.safeParse({
      title: 'My Project',
      description: 'A test project description',
      category: 'web_app',
      budgetMin: 0,
      budgetMax: 100,
      estimatedTimelineDays: 1,
      preferences: {
        almamater: 'ITB',
        minExperience: 3,
        requiredSkills: ['React', 'Node.js'],
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('verifyPhoneSchema', () => {
  it('accepts 6-digit OTP', () => {
    expect(verifyPhoneSchema.safeParse({ code: '123456' }).success).toBe(true)
    expect(verifyPhoneSchema.safeParse({ code: '000000' }).success).toBe(true)
  })

  it('rejects non-numeric', () => {
    expect(verifyPhoneSchema.safeParse({ code: 'abcdef' }).success).toBe(false)
  })

  it('rejects wrong length', () => {
    expect(verifyPhoneSchema.safeParse({ code: '12345' }).success).toBe(false)
    expect(verifyPhoneSchema.safeParse({ code: '1234567' }).success).toBe(false)
  })
})

describe('requestOtpSchema', () => {
  it('validates phone', () => {
    expect(requestOtpSchema.safeParse({ phone: '+6281234567890' }).success).toBe(true)
  })

  it('rejects invalid phone', () => {
    expect(requestOtpSchema.safeParse({ phone: '0812345' }).success).toBe(false)
  })
})

describe('paginationSchema', () => {
  it('has defaults', () => {
    const result = paginationSchema.parse({})
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
  })

  it('accepts custom values', () => {
    const result = paginationSchema.parse({ page: 3, pageSize: 50 })
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(50)
  })

  it('rejects pageSize over 100', () => {
    const result = paginationSchema.safeParse({ pageSize: 101 })
    expect(result.success).toBe(false)
  })

  it('coerces string to number', () => {
    const result = paginationSchema.parse({ page: '2', pageSize: '10' })
    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(10)
  })
})

describe('registerTalentSchema', () => {
  it('validates talent registration', () => {
    const result = registerTalentSchema.safeParse({
      yearsOfExperience: 3,
      skills: [
        {
          name: 'React',
          proficiencyLevel: 'advanced',
          isPrimary: true,
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative experience', () => {
    const result = registerTalentSchema.safeParse({
      yearsOfExperience: -1,
      skills: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('submitMilestoneSchema', () => {
  it('validates submission', () => {
    const result = submitMilestoneSchema.safeParse({
      milestoneId: '01912345-6789-7abc-8def-0123456789ab',
    })
    expect(result.success).toBe(true)
  })

  it('accepts deliverables', () => {
    const result = submitMilestoneSchema.safeParse({
      milestoneId: '01912345-6789-7abc-8def-0123456789ab',
      notes: 'Completed',
      deliverables: [
        {
          title: 'API docs',
          type: 'document',
          submittedUrl: 'https://example.com/doc',
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe('createRevisionRequestSchema', () => {
  it('validates revision request', () => {
    const result = createRevisionRequestSchema.safeParse({
      milestoneId: '01912345-6789-7abc-8def-0123456789ab',
      description: 'Please fix the login flow and error handling',
      severity: 'minor',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid severity', () => {
    const result = createRevisionRequestSchema.safeParse({
      milestoneId: '01912345-6789-7abc-8def-0123456789ab',
      description: 'Long enough description',
      severity: 'critical',
    })
    expect(result.success).toBe(false)
  })
})

describe('createTimeLogSchema', () => {
  it('validates time log', () => {
    const result = createTimeLogSchema.safeParse({
      taskId: '01912345-6789-7abc-8def-0123456789ab',
      startedAt: '2025-01-15T09:00:00Z',
      endedAt: '2025-01-15T12:00:00Z',
      durationMinutes: 180,
    })
    expect(result.success).toBe(true)
  })
})

describe('sendChatMessageSchema', () => {
  it('validates chat message', () => {
    const result = sendChatMessageSchema.safeParse({
      conversationId: '01912345-6789-7abc-8def-0123456789ab',
      content: 'Hello, world!',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty content', () => {
    const result = sendChatMessageSchema.safeParse({
      conversationId: '01912345-6789-7abc-8def-0123456789ab',
      content: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('createDisputeSchema', () => {
  it('validates dispute', () => {
    const result = createDisputeSchema.safeParse({
      projectId: '01912345-6789-7abc-8def-0123456789ab',
      reason: 'Talent did not deliver as specified in PRD',
    })
    expect(result.success).toBe(true)
  })

  it('accepts evidence URLs', () => {
    const result = createDisputeSchema.safeParse({
      projectId: '01912345-6789-7abc-8def-0123456789ab',
      reason: 'Talent did not deliver as specified',
      evidenceUrls: ['https://example.com/screenshot.png'],
    })
    expect(result.success).toBe(true)
  })
})

describe('createReviewSchema', () => {
  it('validates review', () => {
    const result = createReviewSchema.safeParse({
      projectId: '01912345-6789-7abc-8def-0123456789ab',
      revieweeId: '01912345-6789-7abc-8def-123456789abd',
      rating: 4,
      comment: 'Great work!',
    })
    expect(result.success).toBe(true)
  })

  it('rejects rating out of range', () => {
    expect(
      createReviewSchema.safeParse({
        projectId: '01912345-6789-7abc-8def-0123456789ab',
        revieweeId: '01912345-6789-7abc-8def-123456789abd',
        rating: 0,
        comment: 'Bad',
      }).success,
    ).toBe(false)
    expect(
      createReviewSchema.safeParse({
        projectId: '01912345-6789-7abc-8def-0123456789ab',
        revieweeId: '01912345-6789-7abc-8def-123456789abd',
        rating: 6,
        comment: 'Perfect',
      }).success,
    ).toBe(false)
  })
})

describe('idParamSchema', () => {
  it('accepts valid UUID', () => {
    expect(idParamSchema.safeParse({ id: '01912345-6789-7abc-8def-0123456789ab' }).success).toBe(
      true,
    )
  })

  it('rejects non-UUID', () => {
    expect(idParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('apiResponseSchema', () => {
  it('creates response schema', () => {
    const schema = apiResponseSchema(z.string())
    const result = schema.safeParse({
      success: true,
      data: 'hello',
    })
    expect(result.success).toBe(true)
  })
})

describe('paginatedResponseSchema', () => {
  it('creates paginated schema', () => {
    const schema = paginatedResponseSchema(z.string())
    const result = schema.safeParse({
      items: ['a', 'b'],
      total: 2,
      page: 1,
      pageSize: 20,
    })
    expect(result.success).toBe(true)
  })
})
