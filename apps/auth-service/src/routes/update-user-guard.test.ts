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
