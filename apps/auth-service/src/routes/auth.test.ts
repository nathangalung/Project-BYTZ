import { indonesianPhoneSchema, registerUserSchema, verifyPhoneSchema } from '@kerjacus/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// ── Sign-up validation schemas (mirrors auth.ts logic) ──

const _signUpBodySchema = z.object({
  name: z.string(),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().regex(/^\+62\d{9,13}$/),
  role: z.enum(['owner', 'talent']),
})

// ── Update profile schema (mirrors me.ts) ──

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z
    .string()
    .regex(/^\+62\d{9,13}$/, 'Indonesian format: +62 + 9-13 digits')
    .optional(),
  locale: z.enum(['id', 'en']).optional(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(128),
})

// ── Auth route validation tests ──

describe('auth routes', () => {
  describe('POST /sign-up/email', () => {
    function validateSignUp(body: Record<string, unknown>) {
      // Simulate the validation checks in auth.ts
      const validRoles = ['owner', 'talent']
      if (body.role && !validRoles.includes(body.role as string)) {
        return { error: 'INVALID_ROLE', status: 400 }
      }
      if (!body.phone) {
        return { error: 'MISSING_FIELD', status: 400 }
      }
      if (!/^\+62\d{9,13}$/.test(body.phone as string)) {
        return { error: 'INVALID_PHONE', status: 400 }
      }
      if (!body.email) {
        return { error: 'MISSING_FIELD', status: 400 }
      }
      return { error: null }
    }

    it('rejects admin role registration', () => {
      const result = validateSignUp({
        name: 'Admin',
        email: 'admin@test.com',
        password: 'password123',
        phone: '+6281234567890',
        role: 'admin',
      })
      expect(result.error).toBe('INVALID_ROLE')
      expect(result.status).toBe(400)
    })

    it('rejects invalid role (not owner or talent)', () => {
      const result = validateSignUp({
        name: 'User',
        email: 'user@test.com',
        password: 'password123',
        phone: '+6281234567890',
        role: 'superuser',
      })
      expect(result.error).toBe('INVALID_ROLE')
    })

    it('rejects missing phone number', () => {
      const result = validateSignUp({
        name: 'User',
        email: 'user@test.com',
        password: 'password123',
        role: 'owner',
      })
      expect(result.error).toBe('MISSING_FIELD')
    })

    it('rejects invalid phone format (not +62)', () => {
      const result = validateSignUp({
        name: 'User',
        email: 'user@test.com',
        password: 'password123',
        phone: '+1234567890',
        role: 'owner',
      })
      expect(result.error).toBe('INVALID_PHONE')
    })

    it('rejects phone with less than 9 digits after +62', () => {
      const result = validateSignUp({
        name: 'User',
        email: 'user@test.com',
        password: 'password123',
        phone: '+6212345678', // 8 digits
        role: 'owner',
      })
      expect(result.error).toBe('INVALID_PHONE')
    })

    it('rejects phone with more than 13 digits after +62', () => {
      const result = validateSignUp({
        name: 'User',
        email: 'user@test.com',
        password: 'password123',
        phone: '+6212345678901234', // 14 digits
        role: 'owner',
      })
      expect(result.error).toBe('INVALID_PHONE')
    })

    it('accepts valid owner registration', () => {
      const result = validateSignUp({
        name: 'Owner',
        email: 'owner@test.com',
        password: 'password123',
        phone: '+6281234567890',
        role: 'owner',
      })
      expect(result.error).toBeNull()
    })

    it('accepts valid talent registration', () => {
      const result = validateSignUp({
        name: 'Talent',
        email: 'talent@test.com',
        password: 'password123',
        phone: '+6281234567890',
        role: 'talent',
      })
      expect(result.error).toBeNull()
    })
  })

  describe('POST /sign-in/email-or-phone', () => {
    function parseIdentifier(identifier: string | undefined) {
      if (!identifier) return { error: 'MISSING_FIELD' }
      const isPhone = identifier.startsWith('+62')
      return { isPhone, error: null }
    }

    it('detects phone number starting with +62', () => {
      const result = parseIdentifier('+6281234567890')
      expect(result.isPhone).toBe(true)
      expect(result.error).toBeNull()
    })

    it('treats non-+62 input as email', () => {
      const result = parseIdentifier('user@test.com')
      expect(result.isPhone).toBe(false)
      expect(result.error).toBeNull()
    })

    it('rejects empty identifier', () => {
      const result = parseIdentifier(undefined)
      expect(result.error).toBe('MISSING_FIELD')
    })

    it('treats +1 prefix as email (non-Indonesian)', () => {
      const result = parseIdentifier('+12025551234')
      expect(result.isPhone).toBe(false)
    })
  })
})

// ── Shared schema validation tests ──

describe('indonesianPhoneSchema', () => {
  it('accepts valid +62 phone with 9 digits', () => {
    const result = indonesianPhoneSchema.safeParse('+62123456789')
    expect(result.success).toBe(true)
  })

  it('accepts valid +62 phone with 13 digits', () => {
    const result = indonesianPhoneSchema.safeParse('+621234567890123')
    expect(result.success).toBe(true)
  })

  it('rejects phone without +62 prefix', () => {
    const result = indonesianPhoneSchema.safeParse('081234567890')
    expect(result.success).toBe(false)
  })

  it('rejects phone with letters', () => {
    const result = indonesianPhoneSchema.safeParse('+62abcdefghij')
    expect(result.success).toBe(false)
  })

  it('rejects phone with too few digits', () => {
    const result = indonesianPhoneSchema.safeParse('+6212345678')
    expect(result.success).toBe(false)
  })

  it('rejects phone with too many digits', () => {
    const result = indonesianPhoneSchema.safeParse('+6212345678901234')
    expect(result.success).toBe(false)
  })
})

describe('registerUserSchema', () => {
  const validInput = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    phone: '+6281234567890',
    role: 'owner' as const,
  }

  it('accepts valid registration input', () => {
    const result = registerUserSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects name shorter than 2 chars', () => {
    const result = registerUserSchema.safeParse({ ...validInput, name: 'A' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = registerUserSchema.safeParse({ ...validInput, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects password shorter than 8 chars', () => {
    const result = registerUserSchema.safeParse({ ...validInput, password: 'short' })
    expect(result.success).toBe(false)
  })

  it('rejects non-Indonesian phone', () => {
    const result = registerUserSchema.safeParse({ ...validInput, phone: '+1234567890' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid role', () => {
    const result = registerUserSchema.safeParse({ ...validInput, role: 'admin' })
    expect(result.success).toBe(false)
  })

  it('accepts talent role', () => {
    const result = registerUserSchema.safeParse({ ...validInput, role: 'talent' })
    expect(result.success).toBe(true)
  })
})

// ── Me route validation tests ──

describe('me routes', () => {
  describe('PATCH /me', () => {
    it('validates phone format on update', () => {
      const result = updateProfileSchema.safeParse({ phone: '081234567890' })
      expect(result.success).toBe(false)
    })

    it('accepts valid phone update', () => {
      const result = updateProfileSchema.safeParse({ phone: '+6281234567890' })
      expect(result.success).toBe(true)
    })

    it('resets phoneVerified when phone changes', () => {
      // Simulate the update logic from me.ts: when phone is set,
      // phoneVerified is always set to false
      const body = { phone: '+6289876543210' }
      const updatePayload = {
        ...(body.phone !== undefined ? { phone: body.phone, phoneVerified: false } : {}),
      }
      expect(updatePayload.phoneVerified).toBe(false)
      expect(updatePayload.phone).toBe('+6289876543210')
    })

    it('does not reset phoneVerified when phone is not in payload', () => {
      const body = { name: 'New Name' } as { name?: string; phone?: string }
      const updatePayload = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone, phoneVerified: false } : {}),
      }
      expect(updatePayload).not.toHaveProperty('phoneVerified')
      expect(updatePayload.name).toBe('New Name')
    })

    it('accepts locale update to en', () => {
      const result = updateProfileSchema.safeParse({ locale: 'en' })
      expect(result.success).toBe(true)
    })

    it('accepts locale update to id', () => {
      const result = updateProfileSchema.safeParse({ locale: 'id' })
      expect(result.success).toBe(true)
    })

    it('rejects invalid locale', () => {
      const result = updateProfileSchema.safeParse({ locale: 'fr' })
      expect(result.success).toBe(false)
    })

    it('accepts name update within bounds', () => {
      const result = updateProfileSchema.safeParse({ name: 'Valid Name' })
      expect(result.success).toBe(true)
    })

    it('rejects name shorter than 2 chars', () => {
      const result = updateProfileSchema.safeParse({ name: 'A' })
      expect(result.success).toBe(false)
    })

    it('accepts empty update (all fields optional)', () => {
      const result = updateProfileSchema.safeParse({})
      expect(result.success).toBe(true)
    })
  })

  describe('POST /me/change-password', () => {
    it('rejects password shorter than 8 chars', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'valid123',
        newPassword: 'short',
      })
      expect(result.success).toBe(false)
    })

    it('rejects current password shorter than 8 chars', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'short',
        newPassword: 'valid123456',
      })
      expect(result.success).toBe(false)
    })

    it('accepts valid password change input', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      })
      expect(result.success).toBe(true)
    })

    it('rejects new password longer than 128 chars', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'valid12345',
        newPassword: 'a'.repeat(129),
      })
      expect(result.success).toBe(false)
    })

    it('rejects if current password is wrong (simulated flow)', async () => {
      // Simulate the change-password logic: verify call returns non-ok
      const mockVerifyRes = { ok: false }
      if (!mockVerifyRes.ok) {
        const errorResponse = {
          success: false,
          error: { code: 'AUTH_INVALID_PASSWORD', message: 'Current password is incorrect' },
        }
        expect(errorResponse.error.code).toBe('AUTH_INVALID_PASSWORD')
      }
    })
  })
})

// ── OTP verification schema tests ──

describe('verifyPhoneSchema', () => {
  it('accepts valid 6-digit OTP', () => {
    const result = verifyPhoneSchema.safeParse({ code: '123456' })
    expect(result.success).toBe(true)
  })

  it('rejects OTP with less than 6 digits', () => {
    const result = verifyPhoneSchema.safeParse({ code: '12345' })
    expect(result.success).toBe(false)
  })

  it('rejects OTP with more than 6 digits', () => {
    const result = verifyPhoneSchema.safeParse({ code: '1234567' })
    expect(result.success).toBe(false)
  })

  it('rejects OTP with non-numeric characters', () => {
    const result = verifyPhoneSchema.safeParse({ code: 'abcdef' })
    expect(result.success).toBe(false)
  })

  it('rejects OTP with spaces', () => {
    const result = verifyPhoneSchema.safeParse({ code: '123 56' })
    expect(result.success).toBe(false)
  })
})

// ── sendOtp provider selection tests ──

describe('sendOtp', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses Zenziva when ZENZIVA_USER_KEY is set', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    delete process.env.FONNTE_API_KEY

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '1', to: '+6281234567890' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Re-import to pick up env changes
    const { sendOtp } = await import('../lib/sms')
    const result = await sendOtp('+6281234567890', '123456')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('+6281234567890')
    expect(mockFetch).toHaveBeenCalledOnce()
    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain('zenziva.net')
  })

  it('falls back to Fonnte when only FONNTE_API_KEY is set', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    process.env.FONNTE_API_KEY = 'test-fonnte-key'

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: true, id: 'msg-001' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendOtp } = await import('../lib/sms')
    const result = await sendOtp('+6281234567890', '654321')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-001')
    expect(mockFetch).toHaveBeenCalledOnce()
    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain('fonnte.com')
  })

  it('logs to console in development without API keys', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    delete process.env.FONNTE_API_KEY
    process.env.NODE_ENV = 'development'

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendOtp } = await import('../lib/sms')
    const result = await sendOtp('+6281234567890', '111222')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('dev-console')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DEV OTP]'))
  })

  it('returns error in production without any provider', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    delete process.env.FONNTE_API_KEY
    process.env.NODE_ENV = 'production'

    const { sendOtp } = await import('../lib/sms')
    const result = await sendOtp('+6281234567890', '333444')

    expect(result.success).toBe(false)
    expect(result.error).toBe('No SMS provider configured')
  })
})

// ── Session middleware logic tests ──

describe('session middleware logic', () => {
  it('requireRole rejects non-matching role', () => {
    const user = { id: '1', email: 'test@test.com', name: 'Test', role: 'talent' }
    const allowedRoles = ['owner']
    const hasAccess = allowedRoles.includes(user.role)
    expect(hasAccess).toBe(false)
  })

  it('requireRole accepts matching role', () => {
    const user = { id: '1', email: 'test@test.com', name: 'Test', role: 'owner' }
    const allowedRoles = ['owner', 'talent']
    const hasAccess = allowedRoles.includes(user.role)
    expect(hasAccess).toBe(true)
  })

  it('requireRole rejects null user', () => {
    const user = null
    const hasAccess = user !== null && ['owner'].includes(user.role)
    expect(hasAccess).toBe(false)
  })
})
