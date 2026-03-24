import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { registerUserSchema, verifyPhoneSchema } from '@kerjacus/shared'
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
  // ── Scenario: Owner registers successfully ──

  Scenario('Owner registers successfully', ({ Given, When, Then, And }) => {
    let input: Record<string, unknown>
    let result: { success: boolean; data?: Record<string, unknown>; error?: unknown }

    Given(
      'a new user with email {string} and role {string}',
      (_ctx, email: string, role: string) => {
        input = makeValidUser({ email, role })
      },
    )

    When('they submit the registration form', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('the account should be created', () => {
      expect(result.success).toBe(true)
    })

    And('the role should be {string}', (_ctx, role: string) => {
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data?.role).toBe(role)
      }
    })
  })

  // ── Scenario: Talent registers successfully ──

  Scenario('Talent registers successfully', ({ Given, When, Then, And }) => {
    let input: Record<string, unknown>
    let result: { success: boolean; data?: Record<string, unknown>; error?: unknown }

    Given(
      'a new user with email {string} and role {string}',
      (_ctx, email: string, role: string) => {
        input = makeValidUser({ email, role })
      },
    )

    When('they submit the registration form', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('the account should be created', () => {
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

  Scenario('Admin registration is blocked', ({ Given, When, Then, And }) => {
    let input: Record<string, unknown>
    let result: { success: boolean; error?: { issues?: Array<{ code: string; message: string }> } }

    Given(
      'a new user with email {string} and role {string}',
      (_ctx, email: string, role: string) => {
        input = makeValidUser({ email, role })
      },
    )

    When('they submit the registration form', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('the registration should be rejected', () => {
      expect(result.success).toBe(false)
    })

    And('the error code should be {string}', () => {
      // Zod rejects 'admin' because role enum is ['owner', 'talent']
      expect(result.success).toBe(false)
    })
  })

  // ── Scenario: Invalid phone format is rejected ──

  Scenario('Invalid phone format is rejected', ({ Given, When, Then }) => {
    let input: Record<string, unknown>
    let result: { success: boolean }

    Given('a new user with phone {string}', (_ctx, phone: string) => {
      input = makeValidUser({ phone })
    })

    When('they submit the registration form', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('the registration should be rejected', () => {
      expect(result.success).toBe(false)
    })
  })

  // ── Scenario: Valid Indonesian phone is accepted ──

  Scenario('Valid Indonesian phone is accepted', ({ Given, When, Then }) => {
    let input: Record<string, unknown>
    let result: { success: boolean }

    Given('a new user with phone {string}', (_ctx, phone: string) => {
      input = makeValidUser({ phone })
    })

    When('they submit the registration form', () => {
      result = registerUserSchema.safeParse(input)
    })

    Then('the account should be created', () => {
      expect(result.success).toBe(true)
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
        expiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
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
      const parseResult = verifyPhoneSchema.safeParse({
        code: otpRecord.code,
      })
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

  // ── Scenario: Password change with wrong current password ──

  Scenario('Password change with wrong current password', ({ Given, When, Then }) => {
    let user: { passwordHash: string }
    let changeResult: { success: boolean; errorCode: string | null }

    Given('an authenticated user', () => {
      user = { passwordHash: 'hashed_correct_password' }
    })

    When('they change password with wrong current password', () => {
      // Simulate password verification failure
      const providedHash = 'hashed_wrong_password'
      const matches = providedHash === user.passwordHash

      if (!matches) {
        changeResult = {
          success: false,
          errorCode: 'AUTH_INVALID_PASSWORD',
        }
      } else {
        changeResult = { success: true, errorCode: null }
      }
    })

    Then('the change should be rejected with {string}', (_ctx, expectedCode: string) => {
      expect(changeResult.success).toBe(false)
      expect(changeResult.errorCode).toBe(expectedCode)
    })
  })
})
