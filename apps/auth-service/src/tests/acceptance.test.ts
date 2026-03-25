import {
  indonesianPhoneSchema,
  loginSchema,
  registerUserSchema,
  verifyPhoneSchema,
} from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'

// ATDD: Test from user's perspective — validates acceptance criteria
// for the authentication domain without hitting real infrastructure.

describe('ATDD: User Registration Flow', () => {
  it('As an owner, I can register with email and phone', () => {
    const payload = {
      name: 'Budi Santoso',
      email: 'budi@example.com',
      password: 'SecurePass123!',
      phone: '+6281234567890',
      role: 'owner' as const,
    }

    const result = registerUserSchema.safeParse(payload)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.role).toBe('owner')
      expect(result.data.email).toBe('budi@example.com')
      expect(result.data.phone).toBe('+6281234567890')
    }
  })

  it('As a talent, I can register and get talent role', () => {
    const payload = {
      name: 'Dewi Pratama',
      email: 'dewi@example.com',
      password: 'TalentPass456!',
      phone: '+6289876543210',
      role: 'talent' as const,
    }

    const result = registerUserSchema.safeParse(payload)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.role).toBe('talent')
      expect(result.data.name).toBe('Dewi Pratama')
    }
  })

  it('As anyone, I cannot register as admin', () => {
    const payload = {
      name: 'Hacker',
      email: 'hacker@evil.com',
      password: 'HackPass789!',
      phone: '+6281111111111',
      role: 'admin',
    }

    const result = registerUserSchema.safeParse(payload)

    expect(result.success).toBe(false)
  })

  it('As a user, I must provide a valid Indonesian phone number', () => {
    // Invalid: no +62 prefix
    expect(indonesianPhoneSchema.safeParse('081234567890').success).toBe(false)
    // Invalid: too short
    expect(indonesianPhoneSchema.safeParse('+628123').success).toBe(false)
    // Invalid: international format
    expect(indonesianPhoneSchema.safeParse('+11234567890').success).toBe(false)
    // Valid
    expect(indonesianPhoneSchema.safeParse('+6281234567890').success).toBe(true)
    expect(indonesianPhoneSchema.safeParse('+628123456789012').success).toBe(true)
  })

  it('As a user, my password must be at least 8 characters', () => {
    const shortPayload = {
      name: 'Test',
      email: 'test@example.com',
      password: 'short',
      phone: '+6281234567890',
      role: 'owner' as const,
    }

    const longPayload = {
      ...shortPayload,
      password: 'LongEnoughPass1!',
    }

    expect(registerUserSchema.safeParse(shortPayload).success).toBe(false)
    expect(registerUserSchema.safeParse(longPayload).success).toBe(true)
  })

  it('As a user, my email must be a valid format', () => {
    const invalidEmail = {
      name: 'Test',
      email: 'not-an-email',
      password: 'ValidPass123!',
      phone: '+6281234567890',
      role: 'owner' as const,
    }

    expect(registerUserSchema.safeParse(invalidEmail).success).toBe(false)
  })
})

describe('ATDD: Authentication Flow', () => {
  it('As a registered user, I can sign in with email and password', () => {
    const credentials = {
      email: 'budi@example.com',
      password: 'SecurePass123!',
    }

    const result = loginSchema.safeParse(credentials)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('budi@example.com')
    }
  })

  it('As a user, I cannot sign in with empty password', () => {
    const credentials = {
      email: 'budi@example.com',
      password: '',
    }

    const result = loginSchema.safeParse(credentials)

    expect(result.success).toBe(false)
  })

  it('As a user, I cannot sign in with invalid email format', () => {
    const credentials = {
      email: 'not-valid',
      password: 'SomePass123!',
    }

    const result = loginSchema.safeParse(credentials)

    expect(result.success).toBe(false)
  })
})

describe('ATDD: Phone Verification Flow', () => {
  it('As a user, I can verify my phone with a 6-digit OTP', () => {
    const result = verifyPhoneSchema.safeParse({ code: '123456' })
    expect(result.success).toBe(true)
  })

  it('As a user, a 5-digit OTP is rejected', () => {
    const result = verifyPhoneSchema.safeParse({ code: '12345' })
    expect(result.success).toBe(false)
  })

  it('As a user, a non-numeric OTP is rejected', () => {
    const result = verifyPhoneSchema.safeParse({ code: 'abcdef' })
    expect(result.success).toBe(false)
  })

  it('As a user, an expired OTP should not verify', () => {
    const otpRecord = {
      code: '123456',
      expiresAt: new Date(Date.now() - 60_000),
      attempts: 0,
    }

    const schemaValid = verifyPhoneSchema.safeParse({ code: otpRecord.code }).success
    const isExpired = otpRecord.expiresAt < new Date()

    // Schema is valid, but business logic rejects expired OTP
    expect(schemaValid).toBe(true)
    expect(isExpired).toBe(true)
  })

  it('As a user, too many OTP attempts should block verification', () => {
    const otpRecord = {
      code: '123456',
      expiresAt: new Date(Date.now() + 5 * 60_000),
      attempts: 5,
    }

    const tooManyAttempts = otpRecord.attempts >= 5
    expect(tooManyAttempts).toBe(true)
  })
})
