import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The profile route was at 23% covered, and it owns two controls worth more
 * than its CRUD: PATCH must not let a caller write role or isVerified, and
 * change-password must check the current password before it changes anything.
 *
 * Drive the real route. A mirrored copy of updateProfileSchema - which
 * auth.test.ts already keeps - passes just as happily when the route it
 * mirrors has stopped using it.
 */

const SESSION_USER = { id: 'user-1', name: 'Test', email: 'owner@test.com', role: 'owner' }

type SetValues = Record<string, unknown>

let selectRows: unknown[] = []
let returningRows: unknown[] = []
let setCalls: SetValues[] = []

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selectRows }) }) }),
    update: () => ({
      set: (values: SetValues) => {
        setCalls.push(values)
        return { where: () => ({ returning: async () => returningRows }) }
      },
    }),
  }),
}))

vi.mock('../middleware/session', () => ({
  sessionMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('user', SESSION_USER)
    await next()
  },
}))

const { meRoute } = await import('./me')

type Body = {
  success: boolean
  data?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

const PROFILE = {
  id: SESSION_USER.id,
  email: SESSION_USER.email,
  name: 'Test',
  phone: '+628123456789',
  phoneVerified: true,
  role: 'owner',
  avatarUrl: null,
  isVerified: true,
  locale: 'id',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
}

function post(path: string, body: unknown) {
  return meRoute.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patch(body: unknown, headers: Record<string, string> = {}) {
  return meRoute.request('/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** Resend-style responses for the two Better Auth calls change-password makes. */
function fetchReturning(...results: Array<{ ok: boolean }>) {
  const calls: Array<[string, RequestInit]> = []
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init])
    return { ok: results[calls.length - 1]?.ok ?? true } as Response
  })
  vi.stubGlobal('fetch', mock)
  return { mock, calls }
}

beforeEach(() => {
  selectRows = []
  returningRows = []
  setCalls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /', () => {
  it('returns the stored profile', async () => {
    selectRows = [PROFILE]

    const res = await meRoute.request('/')
    const body = (await res.json()) as Body

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.id).toBe(SESSION_USER.id)
    expect(body.data?.email).toBe(SESSION_USER.email)
  })

  /** A live session whose row is gone - deleted account, restored backup. */
  it('replies 404 when the session outlives the row', async () => {
    selectRows = []

    const res = await meRoute.request('/')
    const body = (await res.json()) as Body

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('NOT_FOUND')
  })
})

describe('PATCH /', () => {
  it('writes only the name when only the name is sent', async () => {
    returningRows = [PROFILE]

    const res = await patch({ name: 'Budi Santoso' })

    expect(res.status).toBe(200)
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]?.name).toBe('Budi Santoso')
    expect(setCalls[0]).not.toHaveProperty('phone')
    expect(setCalls[0]).not.toHaveProperty('locale')
  })

  /**
   * The invariant behind the OTP flow: a number that has just changed has not
   * been proved, so the verified flag has to fall with it. Leaving it true
   * carries the old number's proof over to a number nobody verified.
   */
  it('clears phoneVerified whenever the phone changes', async () => {
    returningRows = [PROFILE]

    await patch({ phone: '+6281234567890' })

    expect(setCalls[0]?.phone).toBe('+6281234567890')
    expect(setCalls[0]?.phoneVerified).toBe(false)
  })

  it('does not touch phoneVerified when the phone is not in the body', async () => {
    returningRows = [PROFILE]

    await patch({ locale: 'en' })

    expect(setCalls[0]?.locale).toBe('en')
    expect(setCalls[0]).not.toHaveProperty('phoneVerified')
  })

  it('writes nothing but the timestamp for an empty body', async () => {
    returningRows = [PROFILE]

    const res = await patch({})

    expect(res.status).toBe(200)
    expect(Object.keys(setCalls[0] ?? {})).toEqual(['updatedAt'])
    expect(setCalls[0]?.updatedAt).toBeInstanceOf(Date)
  })

  /**
   * Privilege escalation by PATCH. The schema lists three fields and Zod strips
   * the rest, so a caller naming role or isVerified must have both dropped
   * before the update is built - asserted on what was written, not on what the
   * fake returned.
   */
  it('refuses to write role or isVerified even when they are sent', async () => {
    returningRows = [PROFILE]

    await patch({ name: 'Budi', role: 'admin', isVerified: true, id: 'someone-else' })

    expect(setCalls[0]).not.toHaveProperty('role')
    expect(setCalls[0]).not.toHaveProperty('isVerified')
    expect(setCalls[0]).not.toHaveProperty('id')
    expect(setCalls[0]?.name).toBe('Budi')
  })

  it('replies 404 when the update matches no row', async () => {
    returningRows = []

    const res = await patch({ name: 'Budi' })
    const body = (await res.json()) as Body

    expect(res.status).toBe(404)
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  // Each of these must be refused before anything is written: a rejected body
  // that still reached .set() would have written the timestamp on its way out.
  const REJECTED = [
    { name: 'a phone without the +62 prefix', body: { phone: '08123456789' } },
    { name: 'a phone with too few digits', body: { phone: '+6212345678' } },
    { name: 'a phone with too many digits', body: { phone: '+62123456789012345' } },
    { name: 'a one-character name', body: { name: 'a' } },
    { name: 'a name past 100 characters', body: { name: 'x'.repeat(101) } },
    { name: 'a locale outside the two supported', body: { locale: 'fr' } },
    { name: 'a name of the wrong type', body: { name: 42 } },
  ] as const

  for (const testCase of REJECTED) {
    it(`rejects ${testCase.name} without writing`, async () => {
      const res = await patch(testCase.body)

      expect(res.status).toBe(400)
      expect(setCalls).toEqual([])
    })
  }
})

describe('POST /change-password', () => {
  const VALID = { currentPassword: 'old-password', newPassword: 'new-password-1' }

  /**
   * The control. If the current-password check fails and the change call still
   * goes out, anyone holding a stolen session cookie can set a new password
   * without knowing the old one - so the assertion that matters is the call
   * count, not the 400.
   */
  it('never reaches the change call when the current password is wrong', async () => {
    const { mock, calls } = fetchReturning({ ok: false })

    const res = await post('/change-password', VALID)
    const body = (await res.json()) as Body

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('AUTH_INVALID_PASSWORD')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(calls[0]?.[0]).toContain('/sign-in/email')
  })

  it('reports a failed change as 500 rather than success', async () => {
    fetchReturning({ ok: true }, { ok: false })

    const res = await post('/change-password', VALID)
    const body = (await res.json()) as Body

    expect(res.status).toBe(500)
    expect(body.error?.code).toBe('AUTH_PASSWORD_CHANGE_FAILED')
  })

  it('verifies then changes, and returns success', async () => {
    const { calls } = fetchReturning({ ok: true }, { ok: true })

    const res = await post('/change-password', VALID)
    const body = (await res.json()) as Body

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0]).toContain('/api/v1/auth/sign-in/email')
    expect(calls[1]?.[0]).toContain('/api/v1/auth/change-password')
    // Both passwords, the right way round. Swapping them sets the password to
    // the one the caller already had, and every status assertion still passes.
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual(VALID)
  })

  /**
   * The password is checked against the session's email, never one the caller
   * names. Taking an email from the body would let a caller verify their own
   * password and change somebody else's.
   */
  it('checks the password against the session email, not a supplied one', async () => {
    const { calls } = fetchReturning({ ok: true }, { ok: true })

    await post('/change-password', { ...VALID, email: 'victim@test.com' })

    const sent = JSON.parse(String(calls[0]?.[1].body)) as { email: string; password: string }
    expect(sent.email).toBe(SESSION_USER.email)
    expect(sent.password).toBe(VALID.currentPassword)
  })

  it('forwards the caller cookie to the change call', async () => {
    const { calls } = fetchReturning({ ok: true }, { ok: true })

    await meRoute.request('/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'kerjacus.session_token=abc' },
      body: JSON.stringify(VALID),
    })

    const headers = calls[1]?.[1].headers as Record<string, string>
    expect(headers.Cookie).toBe('kerjacus.session_token=abc')
  })

  it('sends an empty cookie header rather than undefined when none arrives', async () => {
    const { calls } = fetchReturning({ ok: true }, { ok: true })

    await post('/change-password', VALID)

    const headers = calls[1]?.[1].headers as Record<string, string>
    expect(headers.Cookie).toBe('')
  })

  it('calls the configured auth service', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'http://auth.internal:3001')
    const { calls } = fetchReturning({ ok: true }, { ok: true })

    await post('/change-password', VALID)

    expect(calls[0]?.[0]).toBe('http://auth.internal:3001/api/v1/auth/sign-in/email')
  })

  it('falls back to localhost when BETTER_AUTH_URL is unset', async () => {
    vi.stubEnv('BETTER_AUTH_URL', '')
    const { calls } = fetchReturning({ ok: true }, { ok: true })

    await post('/change-password', VALID)

    expect(calls[0]?.[0]).toBe('http://localhost:3001/api/v1/auth/sign-in/email')
  })

  const REJECTED = [
    { name: 'a new password under 8 characters', body: { ...VALID, newPassword: 'short' } },
    { name: 'a current password under 8 characters', body: { ...VALID, currentPassword: 'x' } },
    {
      name: 'a new password past 128 characters',
      body: { ...VALID, newPassword: 'x'.repeat(129) },
    },
    { name: 'a body with no current password', body: { newPassword: 'new-password-1' } },
  ] as const

  for (const testCase of REJECTED) {
    it(`rejects ${testCase.name} without calling the auth service`, async () => {
      const { mock } = fetchReturning({ ok: true }, { ok: true })

      const res = await post('/change-password', testCase.body)

      expect(res.status).toBe(400)
      expect(mock).not.toHaveBeenCalled()
    })
  }
})
