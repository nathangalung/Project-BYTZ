import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { indonesianPhoneSchema, registerUserSchema, verifyPhoneSchema } from '@kerjacus/shared'
import { expect } from 'vitest'

const feature = await loadFeature('src/features/auth.feature')

// Helpers
function makeValidUser(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test User',
    email: 'test@example.com',
    password: 'SecurePass123!',
    phone: '+6281234567890',
    role: 'owner',
    ...overrides,
  }
}

function makeOtpRecord(overrides: Record<string, unknown> = {}) {
  return {
    code: '123456',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    verified: false,
    attempts: 0,
    ...overrides,
  }
}

describeFeature(feature, ({ Scenario }) => {
  // ── Scenario: Owner registration with valid data ──

  Scenario('Owner registration with valid data', ({ Given, When, Then, And }) => {
    let input: Record<string, unknown>
    let result: { success: boolean; data?: Record<string, unknown>; error?: unknown }

    Given('a valid owner registration payload', () => {
      input = makeValidUser({ role: 'owner' })
    })

    When('the registration schema is validated', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('validation should pass', () => {
      expect(result.success).toBe(true)
    })

    And('the role should be {string}', (_ctx, role: string) => {
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data?.role).toBe(role)
      }
    })
  })

  // ── Scenario: Talent registration with valid data ──

  Scenario('Talent registration with valid data', ({ Given, When, Then, And }) => {
    let input: Record<string, unknown>
    let result: { success: boolean; data?: Record<string, unknown>; error?: unknown }

    Given('a valid talent registration payload', () => {
      input = makeValidUser({ email: 'talent@example.com', role: 'talent' })
    })

    When('the registration schema is validated', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('validation should pass', () => {
      expect(result.success).toBe(true)
    })

    And('the role should be {string}', (_ctx, role: string) => {
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data?.role).toBe(role)
      }
    })
  })

  // ── Scenario: Admin registration is blocked ──

  Scenario('Admin registration is blocked', ({ Given, When, Then }) => {
    let input: Record<string, unknown>
    let result: { success: boolean }

    Given('a registration payload with role {string}', (_ctx, role: string) => {
      input = makeValidUser({ role })
    })

    When('the registration schema is validated', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('validation should fail', () => {
      expect(result.success).toBe(false)
    })
  })

  // ── Scenario: Invalid phone format rejected ──

  Scenario('Invalid phone format rejected', ({ Given, When, Then }) => {
    let phone: string
    let result: { success: boolean }

    Given('a registration payload with phone {string}', (_ctx, p: string) => {
      phone = p
    })

    When('the phone schema is validated', () => {
      result = indonesianPhoneSchema.safeParse(phone)
    })

    Then('validation should fail', () => {
      expect(result.success).toBe(false)
    })
  })

  // ── Scenario: Valid Indonesian phone accepted ──

  Scenario('Valid Indonesian phone accepted', ({ Given, When, Then }) => {
    let phone: string
    let result: { success: boolean }

    Given('a registration payload with phone {string}', (_ctx, p: string) => {
      phone = p
    })

    When('the phone schema is validated', () => {
      result = indonesianPhoneSchema.safeParse(phone)
    })

    Then('validation should pass', () => {
      expect(result.success).toBe(true)
    })
  })

  // ── Scenario: OTP code must be 6 digits ──

  Scenario('OTP code must be 6 digits', ({ Given, When, Then }) => {
    let code: string
    let result: { success: boolean }

    Given('an OTP code {string}', (_ctx, c: string) => {
      code = c
    })

    When('the OTP schema is validated', () => {
      result = verifyPhoneSchema.safeParse({ code })
    })

    Then('validation should fail', () => {
      expect(result.success).toBe(false)
    })
  })

  // ── Scenario: Valid OTP code accepted ──

  Scenario('Valid OTP code accepted', ({ Given, When, Then }) => {
    let code: string
    let result: { success: boolean }

    Given('an OTP code {string}', (_ctx, c: string) => {
      code = c
    })

    When('the OTP schema is validated', () => {
      result = verifyPhoneSchema.safeParse({ code })
    })

    Then('validation should pass', () => {
      expect(result.success).toBe(true)
    })
  })

  // ── Scenario: Password change requires minimum length ──

  Scenario('Password change requires minimum length', ({ Given, When, Then }) => {
    let password: string
    let result: { success: boolean }

    Given('a new password {string}', (_ctx, p: string) => {
      password = p
    })

    When('the password is checked', () => {
      const passwordSchema = registerUserSchema.shape.password
      result = passwordSchema.safeParse(password)
    })

    Then('it should be rejected for being too short', () => {
      expect(result.success).toBe(false)
    })
  })

  // ── Scenario: OTP verification succeeds ──

  Scenario('OTP verification succeeds', ({ Given, When, Then }) => {
    let otpRecord: ReturnType<typeof makeOtpRecord>
    let verificationResult: { verified: boolean }

    Given('a user with a valid OTP code', () => {
      otpRecord = makeOtpRecord()
    })

    When('they verify the OTP', () => {
      const parseResult = verifyPhoneSchema.safeParse({ code: otpRecord.code })
      const isExpired = otpRecord.expiresAt < new Date()
      const tooManyAttempts = otpRecord.attempts >= 5

      if (parseResult.success && !isExpired && !tooManyAttempts) {
        verificationResult = { verified: true }
      } else {
        verificationResult = { verified: false }
      }
    })

    Then('the phone should be marked as verified', () => {
      expect(verificationResult.verified).toBe(true)
    })
  })

  // ── Scenario: Expired OTP is rejected ──

  Scenario('Expired OTP is rejected', ({ Given, When, Then }) => {
    let otpRecord: ReturnType<typeof makeOtpRecord>
    let verificationResult: { verified: boolean }

    Given('a user with an expired OTP code', () => {
      otpRecord = makeOtpRecord({
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
    })

    When('they verify the OTP', () => {
      const parseResult = verifyPhoneSchema.safeParse({ code: otpRecord.code })
      const isExpired = otpRecord.expiresAt < new Date()

      if (parseResult.success && !isExpired) {
        verificationResult = { verified: true }
      } else {
        verificationResult = { verified: false }
      }
    })

    Then('the OTP verification should be rejected', () => {
      expect(verificationResult.verified).toBe(false)
    })
  })

  // ── Scenario: OTP with too many attempts is rejected ──

  Scenario('OTP with too many attempts is rejected', ({ Given, When, Then }) => {
    let otpRecord: ReturnType<typeof makeOtpRecord>
    let verificationResult: { verified: boolean }

    Given('a user who exceeded OTP attempts', () => {
      otpRecord = makeOtpRecord({ attempts: 5 })
    })

    When('they verify the OTP', () => {
      const parseResult = verifyPhoneSchema.safeParse({ code: otpRecord.code })
      const isExpired = otpRecord.expiresAt < new Date()
      const tooManyAttempts = otpRecord.attempts >= 5

      if (parseResult.success && !isExpired && !tooManyAttempts) {
        verificationResult = { verified: true }
      } else {
        verificationResult = { verified: false }
      }
    })

    Then('the OTP verification should be rejected', () => {
      expect(verificationResult.verified).toBe(false)
    })
  })
})
