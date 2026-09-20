import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { talentProfileRoute } from './talent-profiles'

/**
 * Who may hold a talent profile at all.
 *
 * Ownership was the only check: the caller had to be the user named in the
 * body, and nothing asked whether that user was a talent. So a signed-in
 * project owner could POST their own id and insert a talent_profiles row for
 * themselves -- which is what findEligibleTalents selects from, so the owner
 * would enter matching as a candidate on their own marketplace.
 *
 * No database is needed to prove the refusal: the guard runs before getDb().
 */

function session(role: string): SessionUser {
  return { id: 'u-1', email: 'caller@example.test', name: 'Caller', role }
}

function post(caller: SessionUser, body: Record<string, unknown>) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', talentProfileRoute)
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID = { userId: 'u-1', yearsOfExperience: 3 }

type ErrorBody = { success: false; error: { code: string; message: string } }

describe('POST / role guard', () => {
  it.each(['owner', 'admin', ''])('refuses a caller whose role is %s', async (role) => {
    const res = await post(session(role), VALID)

    expect(res.status).toBe(403)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('AUTH_FORBIDDEN')
    expect(body.error.message).toBe('Only talents can maintain a talent profile')
  })

  /** A talent gets past the guard; what happens next needs a database. */
  it('lets a talent through to the write', async () => {
    const res = await post(session('talent'), VALID)

    expect(res.status).not.toBe(403)
    const body = (await res.json()) as Partial<ErrorBody>
    expect(body.error?.code).not.toBe('AUTH_FORBIDDEN')
  })

  /** Ownership is still checked, and it is checked first. */
  it('still refuses a talent writing someone else profile', async () => {
    const res = await post(session('talent'), { ...VALID, userId: 'u-2' })

    expect(res.status).toBe(403)
    expect(((await res.json()) as ErrorBody).error.message).toContain('another user')
  })
})
