import { describe, expect, it, vi } from 'vitest'

// Drive the real route, not a copy of its logic.

const handlerCalls: string[] = []

vi.mock('../lib/auth', () => ({
  auth: {
    handler: async (req: Request) => {
      handlerCalls.push(await req.text())
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  },
}))

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  }),
}))

const { authRoute } = await import('./auth')

function updateUser(body: unknown) {
  return authRoute.request('/update-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /update-user protected fields', () => {
  // role gates the admin panel, dispute decisions and fee breakdowns.
  it('refuses a self-promotion to admin', async () => {
    const res = await updateUser({ role: 'admin' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_FORBIDDEN')
  })

  it('refuses any role change, not only admin', async () => {
    expect((await updateUser({ role: 'talent' })).status).toBe(403)
  })

  // Changing phone leaves phoneVerified true, skipping OTP.
  it('refuses a phone change', async () => {
    expect((await updateUser({ phone: '+6281234567890' })).status).toBe(403)
  })

  it('refuses phoneVerified and isVerified', async () => {
    expect((await updateUser({ phoneVerified: true })).status).toBe(403)
    expect((await updateUser({ isVerified: true })).status).toBe(403)
  })

  it('refuses a protected field smuggled beside an allowed one', async () => {
    expect((await updateUser({ name: 'New Name', role: 'admin' })).status).toBe(403)
  })

  it('still allows an ordinary profile update', async () => {
    handlerCalls.length = 0
    const res = await updateUser({ name: 'New Name' })
    expect(res.status).toBe(200)
    expect(handlerCalls).toHaveLength(1)
    expect(JSON.parse(handlerCalls[0])).toEqual({ name: 'New Name' })
  })

  it('rejects a malformed body instead of forwarding it', async () => {
    const res = await authRoute.request('/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  /**
   * An empty body names no field, so there is nothing to refuse. Treating it as
   * malformed would reject the no-op call Better Auth's client makes, and the
   * guard would be reading protected fields off a body that never parsed.
   */
  it('treats an empty body as an empty update rather than malformed JSON', async () => {
    handlerCalls.length = 0

    const res = await authRoute.request('/update-user', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(handlerCalls).toHaveLength(1)
    expect(handlerCalls[0]).toBe('')
  })
})

/**
 * How the guard above was got around.
 *
 * Hono matches a path literally, so /update-user/ is not /update-user: the
 * request missed the handler that refuses role and phone, fell through to the
 * Better Auth catch-all, and was forwarded with its body untouched. Better
 * Auth then wrote through every additionalField declared input: true, which
 * role was. One trailing slash, and a signed-in owner was an admin.
 *
 * The declaration is closed now too, so this is the second of two locks. Both
 * are worth keeping: the first stops the forward, the second stops anything
 * that is forwarded.
 */
describe('a trailing or doubled slash cannot reach Better Auth', () => {
  const forwarded = () => {
    handlerCalls.length = 0
    return handlerCalls
  }

  it('refuses POST /update-user/ instead of forwarding it', async () => {
    const calls = forwarded()

    const res = await authRoute.request('/update-user/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    expect(calls).toEqual([])
  })

  it('refuses POST /sign-up/email/ instead of forwarding it', async () => {
    const calls = forwarded()

    const res = await authRoute.request('/sign-up/email/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'a@b.co',
        password: 'password123',
        name: 'A',
        phone: '+628123456789',
        role: 'admin',
      }),
    })

    expect(res.status).toBe(404)
    expect(calls).toEqual([])
  })

  it('refuses a doubled slash too', async () => {
    const calls = forwarded()

    const res = await authRoute.request('//update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })

    expect(res.status).toBe(404)
    expect(calls).toEqual([])
  })

  // The catch-all still has a job: sign-out, get-session and the OAuth legs
  // are all Better Auth's, and none of them may start answering 404.
  it('still forwards a path Better Auth owns', async () => {
    const calls = forwarded()

    const res = await authRoute.request('/sign-out', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})

// Google supplies no phone, so it cannot be required at insert.
describe('phone is optional at the schema level', () => {
  it('is nullable so OAuth sign-up can create a user', async () => {
    const { readFileSync } = await import('node:fs')
    const schema = readFileSync(
      new URL('../../../../packages/db/src/schema/better-auth.ts', import.meta.url),
      'utf8',
    )
    expect(schema).toMatch(/phone: text\('phone'\)\.unique\(\)/)
    expect(schema).not.toMatch(/phone: text\('phone'\)\.notNull\(\)/)
  })

  it('is not declared required to Better Auth', async () => {
    const { readFileSync } = await import('node:fs')
    const lib = readFileSync(new URL('../lib/auth.ts', import.meta.url), 'utf8')
    expect(lib).toMatch(/phone: \{ type: 'string', required: false/)
  })
})
