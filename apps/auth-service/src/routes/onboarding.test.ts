import { ERROR_CODES } from '@kerjacus/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The route that repairs a Google sign-up. It is the only writer of `role`
 * after the row exists, so every refusal it makes is a control: drive the real
 * handler, not a copy of its checks.
 */

const SESSION_USER = { id: 'user-1', name: 'Rina', email: 'rina@test.com', role: 'owner' }

// Rows the next .limit() resolves to, in call order: the session user's row
// first, then whoever already holds the submitted phone number.
let selectResults: unknown[][] = []
let setCalls: Record<string, unknown>[] = []

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => selectResults.shift() ?? [] }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push(values)
        return { where: async () => undefined }
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

const { onboardingRoute } = await import('./onboarding')

const CATALOG: string[] = Object.values(ERROR_CODES)

const OAUTH_ROW = {
  id: SESSION_USER.id,
  email: SESSION_USER.email,
  name: SESSION_USER.name,
  phone: null,
  avatarUrl: 'https://cdn/avatar.png',
  locale: 'id',
}

type Body = {
  success: boolean
  data?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

async function complete(body: unknown, rows: unknown[][] = [], raw?: string) {
  selectResults = rows.map((row) => [...row])
  const res = await onboardingRoute.request('/complete-onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
  return { res, body: (await res.json()) as Body }
}

beforeEach(() => {
  selectResults = []
  setCalls = []
})

describe('POST /complete-onboarding', () => {
  it('stores the chosen role and phone on an account that has neither', async () => {
    const { res, body } = await complete({ role: 'talent', phone: '+6281234567890' }, [
      [OAUTH_ROW],
      [],
    ])

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toMatchObject({
      role: 'talent',
      phone: '+6281234567890',
      phoneVerified: false,
    })
  })

  /**
   * Better Auth caches the session for five minutes, so the client cannot wait
   * for get-session to catch up: the reply has to carry the new role itself.
   */
  it('replies with the row as it now stands, not the cached session', async () => {
    const { body } = await complete({ role: 'talent', phone: '+6281234567890' }, [[OAUTH_ROW], []])

    expect(body.data).toEqual({
      id: SESSION_USER.id,
      email: SESSION_USER.email,
      name: SESSION_USER.name,
      phone: '+6281234567890',
      phoneVerified: false,
      role: 'talent',
      avatarUrl: OAUTH_ROW.avatarUrl,
      locale: 'id',
    })
  })

  it('accepts owner too', async () => {
    const { res } = await complete({ role: 'owner', phone: '+6281234567890' }, [[OAUTH_ROW], []])

    expect(res.status).toBe(200)
    expect(setCalls[0]).toMatchObject({ role: 'owner' })
  })

  // The whole point of the endpoint: it must not become a second way to change
  // a role that every other path refuses.
  it('refuses a second call, because the first one set the phone', async () => {
    const { res, body } = await complete({ role: 'talent', phone: '+6281234567899' }, [
      [{ ...OAUTH_ROW, phone: '+6281234567890' }],
    ])

    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('AUTH_FORBIDDEN')
    expect(setCalls).toHaveLength(0)
  })

  it('refuses a phone number another account already holds', async () => {
    const { res, body } = await complete({ role: 'talent', phone: '+6281234567890' }, [
      [OAUTH_ROW],
      [{ id: 'someone-else' }],
    ])

    expect(res.status).toBe(409)
    expect(body.error?.code).toBe('AUTH_PHONE_ALREADY_EXISTS')
    expect(setCalls).toHaveLength(0)
  })

  it('replies 404 when the session outlives the row', async () => {
    const { res, body } = await complete({ role: 'talent', phone: '+6281234567890' }, [[]])

    expect(res.status).toBe(404)
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  /*
   * The code names the field, so the page can say which one to fix. Sharing
   * VALIDATION_ERROR between the role and the phone left one error line that
   * could only say "could not save".
   */
  const REJECTED_BODIES = [
    { name: 'no role at all', body: { phone: '+6281234567890' }, code: 'AUTH_INVALID_ROLE' },
    {
      name: 'admin',
      body: { role: 'admin', phone: '+6281234567890' },
      code: 'AUTH_INVALID_ROLE',
    },
    {
      name: 'an unknown role',
      body: { role: 'superuser', phone: '+6281234567890' },
      code: 'AUTH_INVALID_ROLE',
    },
    {
      name: 'a role that is not a string',
      body: { role: 7, phone: '+6281234567890' },
      code: 'AUTH_INVALID_ROLE',
    },
    { name: 'no phone at all', body: { role: 'talent' }, code: 'AUTH_INVALID_PHONE' },
    {
      name: 'a phone that is not a string',
      body: { role: 'talent', phone: 62812345678 },
      code: 'AUTH_INVALID_PHONE',
    },
    {
      name: 'a non-Indonesian phone',
      body: { role: 'talent', phone: '+1234567890' },
      code: 'AUTH_INVALID_PHONE',
    },
    {
      name: 'too few digits after +62',
      body: { role: 'talent', phone: '+6212345678' },
      code: 'AUTH_INVALID_PHONE',
    },
    {
      name: 'too many digits after +62',
      body: { role: 'talent', phone: '+6212345678901234' },
      code: 'AUTH_INVALID_PHONE',
    },
  ] as const

  for (const testCase of REJECTED_BODIES) {
    it(`rejects ${testCase.name} before it reaches the database`, async () => {
      const { res, body } = await complete(testCase.body, [[OAUTH_ROW], []])

      expect(res.status).toBe(400)
      expect(body.error?.code).toBe(testCase.code)
      expect(setCalls).toHaveLength(0)
    })
  }

  it('rejects a malformed body', async () => {
    const { res, body } = await complete(null, [], 'not json')

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('VALIDATION_ERROR')
    expect(setCalls).toHaveLength(0)
  })

  // An invented code has no i18n key, so the page falls back to the generic
  // message and the user learns nothing about what went wrong.
  it('only uses codes the shared catalog defines', async () => {
    const failures = [
      await complete({}, [[OAUTH_ROW], []]),
      await complete({ role: 'talent', phone: '+6281234567890' }, [[]]),
      await complete({ role: 'talent', phone: '+6281234567890' }, [
        [{ ...OAUTH_ROW, phone: '+6281111111111' }],
      ]),
      await complete({ role: 'talent', phone: '+6281234567890' }, [[OAUTH_ROW], [{ id: 'other' }]]),
    ]

    for (const failure of failures) {
      expect(failure.body.success).toBe(false)
      expect(CATALOG).toContain(failure.body.error?.code)
      expect(failure.body.error?.message).toBeTruthy()
    }
  })
})
