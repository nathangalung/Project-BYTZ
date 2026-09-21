import { ERROR_CODES, ERROR_HTTP_STATUS } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { mapBetterAuthCode, toPlatformEnvelope } from './better-auth-errors'

/**
 * Better Auth answers `{ code, message }`; apps/web reads `error.code`.
 *
 * Nothing bridged the two, so every refusal Better Auth produced arrived as
 * UNKNOWN_ERROR and rendered as the generic line - which is why a duplicate
 * email read "registration failed" and why the login page's unverified-email
 * branch compared against a code that could never reach it.
 */

const CATALOG: string[] = Object.values(ERROR_CODES)

function betterAuthError(code: string, status: number, message = 'from Better Auth') {
  return Response.json({ code, message }, { status })
}

type Envelope = {
  success?: boolean
  error?: { code?: string; message?: string }
  code?: string
  token?: unknown
}

describe('mapping Better Auth codes onto the catalog', () => {
  const CASES: Array<[string, number, string]> = [
    ['USER_ALREADY_EXISTS', 422, 'AUTH_EMAIL_ALREADY_EXISTS'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 422, 'AUTH_EMAIL_ALREADY_EXISTS'],
    ['INVALID_EMAIL_OR_PASSWORD', 401, 'AUTH_INVALID_CREDENTIALS'],
    ['INVALID_PASSWORD', 401, 'AUTH_INVALID_CREDENTIALS'],
    ['INVALID_USER', 401, 'AUTH_INVALID_CREDENTIALS'],
    ['USER_NOT_FOUND', 400, 'AUTH_INVALID_CREDENTIALS'],
    ['ACCOUNT_NOT_FOUND', 400, 'AUTH_INVALID_CREDENTIALS'],
    ['CREDENTIAL_ACCOUNT_NOT_FOUND', 400, 'AUTH_INVALID_CREDENTIALS'],
    ['EMAIL_NOT_VERIFIED', 403, 'AUTH_EMAIL_NOT_VERIFIED'],
    ['INVALID_TOKEN', 400, 'AUTH_INVALID_TOKEN'],
    ['TOKEN_EXPIRED', 400, 'AUTH_INVALID_TOKEN'],
    ['SESSION_EXPIRED', 401, 'AUTH_SESSION_EXPIRED'],
    ['SESSION_NOT_FRESH', 401, 'AUTH_SESSION_EXPIRED'],
    ['EMAIL_ALREADY_VERIFIED', 400, 'CONFLICT'],
    ['INVALID_EMAIL', 400, 'VALIDATION_ERROR'],
    ['PASSWORD_TOO_SHORT', 400, 'VALIDATION_ERROR'],
    ['PASSWORD_TOO_LONG', 400, 'VALIDATION_ERROR'],
    ['VALIDATION_ERROR', 400, 'VALIDATION_ERROR'],
    ['MISSING_FIELD', 400, 'VALIDATION_ERROR'],
    ['BODY_MUST_BE_AN_OBJECT', 400, 'VALIDATION_ERROR'],
    ['FIELD_NOT_ALLOWED', 400, 'VALIDATION_ERROR'],
    ['INVALID_ORIGIN', 403, 'AUTH_FORBIDDEN'],
    ['MISSING_OR_NULL_ORIGIN', 403, 'AUTH_FORBIDDEN'],
    ['INVALID_CALLBACK_URL', 403, 'AUTH_FORBIDDEN'],
    ['INVALID_REDIRECT_URL', 403, 'AUTH_FORBIDDEN'],
    ['CROSS_SITE_NAVIGATION_LOGIN_BLOCKED', 403, 'AUTH_FORBIDDEN'],
    ['FAILED_TO_CREATE_USER', 422, 'INTERNAL_ERROR'],
    ['FAILED_TO_CREATE_SESSION', 400, 'INTERNAL_ERROR'],
    ['FAILED_TO_UPDATE_USER', 400, 'INTERNAL_ERROR'],
    ['FAILED_TO_GET_SESSION', 400, 'INTERNAL_ERROR'],
    ['FAILED_TO_CREATE_VERIFICATION', 400, 'INTERNAL_ERROR'],
  ]

  for (const [betterAuth, status, expected] of CASES) {
    it(`reads ${betterAuth} as ${expected}`, () => {
      expect(mapBetterAuthCode(betterAuth, status)).toBe(expected)
    })
  }

  it('only ever produces a code the shared catalog defines', () => {
    for (const [betterAuth, status] of CASES) {
      expect(CATALOG, betterAuth).toContain(mapBetterAuthCode(betterAuth, status))
    }
  })

  /**
   * The four sign-in rejections answer identically on purpose. A distinct
   * "account not found" turns the login form into a list of who is registered.
   */
  it('says nothing about whether the account exists', () => {
    const codes = ['INVALID_EMAIL_OR_PASSWORD', 'USER_NOT_FOUND', 'ACCOUNT_NOT_FOUND'].map((code) =>
      mapBetterAuthCode(code, 401),
    )

    expect(new Set(codes).size).toBe(1)
  })
})

describe('a code the map has never seen', () => {
  const BY_STATUS: Array<[number, string]> = [
    [400, 'VALIDATION_ERROR'],
    [401, 'AUTH_UNAUTHORIZED'],
    [403, 'AUTH_FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'VALIDATION_ERROR'],
    [429, 'RATE_LIMIT_EXCEEDED'],
  ]

  for (const [status, expected] of BY_STATUS) {
    it(`falls back to ${expected} on a ${status}`, () => {
      expect(mapBetterAuthCode('SOMETHING_BETTER_AUTH_ADDED_LATER', status)).toBe(expected)
    })
  }

  it('falls back to INTERNAL_ERROR on a status with no rule', () => {
    expect(mapBetterAuthCode('WHATEVER', 500)).toBe('INTERNAL_ERROR')
    expect(mapBetterAuthCode('WHATEVER', 502)).toBe('INTERNAL_ERROR')
  })

  it('falls back on a body that carried no code at all', () => {
    expect(mapBetterAuthCode(undefined, 400)).toBe('VALIDATION_ERROR')
    expect(mapBetterAuthCode(42, 409)).toBe('CONFLICT')
  })
})

describe('the response the client receives', () => {
  it('re-states a failure in the envelope api.ts reads', async () => {
    const res = await toPlatformEnvelope(
      betterAuthError('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 422),
    )
    const body = (await res.json()) as Envelope

    expect(res.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('AUTH_EMAIL_ALREADY_EXISTS')
    expect(body.error?.message).toBeTruthy()
    // The old top-level shape is what the client could not read.
    expect(body).not.toHaveProperty('code')
  })

  /**
   * The status comes from the catalog, not from Better Auth: a duplicate email
   * is a 422 there and a 409 here, and apps/web branches on both the code and
   * the status (isNotFound, isSessionEnded). Letting them disagree is how a
   * 401 that means "wrong password" gets read as "your session ended".
   */
  it('takes the status from the code, so the two cannot disagree', async () => {
    for (const [code, status] of [
      ['EMAIL_NOT_VERIFIED', 403],
      ['INVALID_EMAIL_OR_PASSWORD', 401],
      ['PASSWORD_TOO_SHORT', 400],
    ] as const) {
      const res = await toPlatformEnvelope(betterAuthError(code, 500))
      const body = (await res.json()) as Envelope

      expect(res.status, code).toBe(status)
      expect(ERROR_HTTP_STATUS[body.error?.code as never], code).toBe(status)
    }
  })

  it('leaves a success untouched, cookie and all', async () => {
    const original = Response.json({ token: 'tok', user: {} }, { status: 200 })
    original.headers.append('set-cookie', 'kerjacus.session_token=abc; HttpOnly')

    const res = await toPlatformEnvelope(original)

    expect(res).toBe(original)
    expect(res.headers.get('set-cookie')).toContain('kerjacus.session_token')
    expect((await res.json()) as Envelope).toHaveProperty('token', 'tok')
  })

  /** The OAuth legs and the verify-email landing are redirects, not envelopes. */
  it('leaves a redirect untouched', async () => {
    const original = new Response(null, { status: 302, headers: { location: '/dashboard' } })

    expect(await toPlatformEnvelope(original)).toBe(original)
  })

  it('leaves a failure that declares no content type untouched', async () => {
    const original = new Response(null, { status: 503 })

    expect(original.headers.get('content-type')).toBeNull()
    expect(await toPlatformEnvelope(original)).toBe(original)
  })

  it('leaves a non-JSON failure untouched', async () => {
    const original = new Response('<html>gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    })

    expect(await toPlatformEnvelope(original)).toBe(original)
  })

  it('leaves a failure that is already an envelope alone', async () => {
    const res = await toPlatformEnvelope(
      Response.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'nope' } },
        { status: 404 },
      ),
    )
    const body = (await res.json()) as Envelope

    expect(res.status).toBe(404)
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('still answers in the envelope when the body is not JSON at all', async () => {
    const res = await toPlatformEnvelope(
      new Response('not json', { status: 500, headers: { 'content-type': 'application/json' } }),
    )
    const body = (await res.json()) as Envelope

    expect(res.status).toBe(500)
    expect(body.error?.code).toBe('INTERNAL_ERROR')
    expect(body.error?.message).toBe('INTERNAL_ERROR')
  })

  it('keeps Better Auth s message as the operator-facing diagnostic', async () => {
    const res = await toPlatformEnvelope(betterAuthError('INVALID_TOKEN', 400, 'Token expired'))
    const body = (await res.json()) as Envelope

    expect(body.error?.message).toBe('Token expired')
  })

  it('names the code when Better Auth sent no message', async () => {
    const res = await toPlatformEnvelope(Response.json({ code: 'INVALID_TOKEN' }, { status: 400 }))
    const body = (await res.json()) as Envelope

    expect(body.error?.message).toBe('AUTH_INVALID_TOKEN')
  })
})
