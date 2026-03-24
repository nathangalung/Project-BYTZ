import { z } from 'zod'

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})
export type PaginationInput = z.infer<typeof paginationSchema>

// API response
export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })

// Paginated response
export const paginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  })

// Project creation
export const createProjectSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  category: z.enum(['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital']),
  budgetMin: z.number().int().nonnegative(),
  budgetMax: z.number().int().nonnegative(),
  estimatedTimelineDays: z.number().int().positive(),
  preferences: z
    .object({
      almamater: z.string().optional(),
      minExperience: z.number().int().nonnegative().optional(),
      requiredSkills: z.array(z.string()).optional(),
    })
    .optional(),
  documentFileUrl: z.string().optional(),
})
export type CreateProjectInput = z.infer<typeof createProjectSchema>

// Talent registration
export const registerTalentSchema = z.object({
  bio: z.string().max(2000).optional(),
  yearsOfExperience: z.number().int().nonnegative(),
  educationUniversity: z.string().optional(),
  educationMajor: z.string().optional(),
  educationYear: z.number().int().optional(),
  portfolioLinks: z
    .array(
      z.object({
        platform: z.string(),
        url: z.string().url(),
      }),
    )
    .optional(),
  skills: z.array(
    z.object({
      name: z.string(),
      proficiencyLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
      isPrimary: z.boolean().default(false),
    }),
  ),
  domainExpertise: z.array(z.string()).optional(),
  hourlyRateExpectation: z.number().int().positive().optional(),
})
export type RegisterTalentInput = z.infer<typeof registerTalentSchema>

// Indonesian phone: +62 followed by 9-13 digits
export const indonesianPhoneSchema = z
  .string()
  .regex(/^\+62\d{9,13}$/, 'Phone must be Indonesian format: +62 followed by 9-13 digits')

// OTP verification
export const verifyPhoneSchema = z.object({
  code: z
    .string()
    .length(6, 'OTP code must be 6 digits')
    .regex(/^\d{6}$/, 'OTP must be numeric'),
})
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>

export const requestOtpSchema = z.object({
  phone: indonesianPhoneSchema,
})
export type RequestOtpInput = z.infer<typeof requestOtpSchema>

// User registration
export const registerUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: indonesianPhoneSchema,
  role: z.enum(['owner', 'talent']),
})
export type RegisterUserInput = z.infer<typeof registerUserSchema>

// Login
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginSchema>

// Milestone submission
export const submitMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  notes: z.string().max(5000).optional(),
  deliverables: z
    .array(
      z.object({
        title: z.string(),
        type: z.enum(['code', 'document', 'file', 'demo']),
        submittedUrl: z.string().url(),
      }),
    )
    .optional(),
})
export type SubmitMilestoneInput = z.infer<typeof submitMilestoneSchema>

// Revision request
export const createRevisionRequestSchema = z.object({
  milestoneId: z.string().uuid(),
  description: z.string().min(10).max(5000),
  severity: z.enum(['minor', 'moderate', 'major']),
})
export type CreateRevisionRequestInput = z.infer<typeof createRevisionRequestSchema>

// Time log
export const createTimeLogSchema = z.object({
  taskId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
})
export type CreateTimeLogInput = z.infer<typeof createTimeLogSchema>

// Chat message
export const sendChatMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(10000),
})
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>

// Dispute
export const createDisputeSchema = z.object({
  projectId: z.string().uuid(),
  workPackageId: z.string().uuid().optional(),
  reason: z.string().min(10).max(5000),
  evidenceUrls: z.array(z.string().url()).optional(),
})
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>

// Review
export const createReviewSchema = z.object({
  projectId: z.string().uuid(),
  revieweeId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000),
})
export type CreateReviewInput = z.infer<typeof createReviewSchema>

// ID param
export const idParamSchema = z.object({
  id: z.string().uuid(),
})
export type IdParam = z.infer<typeof idParamSchema>
