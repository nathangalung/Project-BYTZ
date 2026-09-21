import { ERROR_HTTP_STATUS, type ErrorCode } from '@kerjacus/shared'

/**
 * Re-states a Better Auth failure in the platform envelope.
 *
 * Better Auth answers `{ code, message }` at the top level. Every other
 * handler in this repo answers `{ success, error: { code, message } }`, and
 * apps/web reads `errorBody.error.code` and builds its copy from that code -
 * so a body in Better Auth's own shape resolved `undefined`, degraded to
 * UNKNOWN_ERROR, and rendered as the generic "something went wrong" line.
 *
 * That is why the register page said "registration failed" for a duplicate it
 * had a precise message for, and why the login page's EMAIL_NOT_VERIFIED
 * branch could never fire: the code it compares against never reached it.
 * Routes that forward to `auth.handler` pass the reply through here, so the
 * client sees one envelope whoever produced the failure.
 *
 * Only failures are rewritten. A success carries the session cookie and must
 * reach the browser byte for byte, and a redirect (the OAuth legs, the
 * verify-email landing) is not an envelope at all.
 */

/**
 * Better Auth's own code for each one the public auth surfaces can produce.
 * The list is BASE_ERROR_CODES; anything absent falls back to the status.
 */
const CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  // Sign-up. Reached when a duplicate slips past the pre-check in routes/auth.ts.
  USER_ALREADY_EXISTS: 'AUTH_EMAIL_ALREADY_EXISTS',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'AUTH_EMAIL_ALREADY_EXISTS',

  // Sign-in. All of these answer the same way on purpose: which half of the
  // pair was wrong, and whether the account exists at all, stay unsaid.
  INVALID_EMAIL_OR_PASSWORD: 'AUTH_INVALID_CREDENTIALS',
  INVALID_PASSWORD: 'AUTH_INVALID_CREDENTIALS',
  INVALID_USER: 'AUTH_INVALID_CREDENTIALS',
  USER_NOT_FOUND: 'AUTH_INVALID_CREDENTIALS',
  ACCOUNT_NOT_FOUND: 'AUTH_INVALID_CREDENTIALS',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'AUTH_INVALID_CREDENTIALS',

  // The one rejection that is not secret: the caller just typed the address,
  // so naming the mailbox as the remedy reveals nothing a guess would not.
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',

  // Password reset and email verification links.
  INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  TOKEN_EXPIRED: 'AUTH_INVALID_TOKEN',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  SESSION_NOT_FRESH: 'AUTH_SESSION_EXPIRED',
  EMAIL_ALREADY_VERIFIED: 'CONFLICT',

  // Body-shape refusals.
  INVALID_EMAIL: 'VALIDATION_ERROR',
  PASSWORD_TOO_SHORT: 'VALIDATION_ERROR',
  PASSWORD_TOO_LONG: 'VALIDATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_FIELD: 'VALIDATION_ERROR',
  BODY_MUST_BE_AN_OBJECT: 'VALIDATION_ERROR',
  FIELD_NOT_ALLOWED: 'VALIDATION_ERROR',

  // CSRF and callback-URL refusals.
  INVALID_ORIGIN: 'AUTH_FORBIDDEN',
  MISSING_OR_NULL_ORIGIN: 'AUTH_FORBIDDEN',
  INVALID_CALLBACK_URL: 'AUTH_FORBIDDEN',
  INVALID_REDIRECT_URL: 'AUTH_FORBIDDEN',
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: 'AUTH_FORBIDDEN',

  // Ours to fix, not the caller's to retry differently.
  FAILED_TO_CREATE_USER: 'INTERNAL_ERROR',
  FAILED_TO_CREATE_SESSION: 'INTERNAL_ERROR',
  FAILED_TO_UPDATE_USER: 'INTERNAL_ERROR',
  FAILED_TO_GET_SESSION: 'INTERNAL_ERROR',
  FAILED_TO_CREATE_VERIFICATION: 'INTERNAL_ERROR',
}

/** Last resort, so an unmapped Better Auth code still lands on a real code. */
const STATUS_MAP: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'AUTH_UNAUTHORIZED',
  403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMIT_EXCEEDED',
}

export function mapBetterAuthCode(code: unknown, status: number): ErrorCode {
  if (typeof code === 'string' && code in CODE_MAP) return CODE_MAP[code] as ErrorCode
  return STATUS_MAP[status] ?? 'INTERNAL_ERROR'
}

/**
 * The reply as the client should see it.
 *
 * The status is taken from the catalog rather than kept from Better Auth, so
 * the code and the status cannot disagree - a duplicate email is a 409 here
 * and a 422 there, and the client branches on both.
 */
export async function toPlatformEnvelope(response: Response): Promise<Response> {
  if (response.status < 400) return response
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return response

  const body = (await response.json().catch(() => null)) as {
    code?: unknown
    message?: unknown
    error?: unknown
  } | null

  // Already one of ours. Better Auth never produces this shape, but the
  // catch-all forwards paths this service may grow its own handler for.
  if (body && typeof body.error === 'object' && body.error !== null) {
    return Response.json(body, { status: response.status })
  }

  const code = mapBetterAuthCode(body?.code, response.status)
  const message = typeof body?.message === 'string' ? body.message : code

  return Response.json(
    { success: false, error: { code, message } },
    {
      status: ERROR_HTTP_STATUS[code],
    },
  )
}
