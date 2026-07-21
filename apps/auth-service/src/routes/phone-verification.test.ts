import { beforeEach, describe, expect, it, vi } from 'vitest'

// Drive the real handler. The rest of this suite mirrors logic into local
// copies, which is exactly how the attempt-counter bug survived: a mirrored
// test passes even when the route it mirrors is broken.

const SESSION_USER = { id: 'user-1', name: 'Test', email: 't@e.st', role: 'owner' }

type UpdateCall = { attempts?: number; verified?: boolean; phoneVerified?: boolean }

let pendingRows: Array<Record<string, unknown>> = []
let updateCalls: UpdateCall[] = []

function makeFakeDb() {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => pendingRows,
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: UpdateCall) => {
        updateCalls.push(values)
        return { where: async () => undefined }
      },
    }),
    insert: () => ({ values: async () => undefined }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => cb(db),
  }
  return db
}

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => makeFakeDb(),
}))

vi.mock('../lib/sms', () => ({ sendOtp: async () => ({ success: true }) }))

vi.mock('../middleware/session', () => ({
  sessionMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('user', SESSION_USER)
    await next()
  },
}))

const { phoneVerificationRoute } = await import('./phone-verification')

function verify(code: string) {
  return phoneVerificationRoute.request('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

beforeEach(() => {
  pendingRows = []
  updateCalls = []
})

describe('POST /verify', () => {
  const pending = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'ver-1',
    userId: SESSION_USER.id,
    phone: '+628123456789',
    code: '123456',
    attempts: 0,
    verified: false,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...over,
  })

  it('charges an attempt when the code is wrong', async () => {
    pendingRows = [pending()]

    const res = await verify('000000')

    expect(res.status).toBe(400)
    // The regression: a wrong guess previously matched no row and returned
    // early, so attempts never advanced and the cap could never fire.
    expect(updateCalls).toEqual([{ attempts: 1 }])
  })

  it('does not mark the phone verified on a wrong code', async () => {
    pendingRows = [pending()]

    await verify('000000')

    expect(updateCalls.some((c) => c.verified === true)).toBe(false)
    expect(updateCalls.some((c) => c.phoneVerified === true)).toBe(false)
  })

  it('refuses once attempts are exhausted, without charging further', async () => {
    pendingRows = [pending({ attempts: 5 })]

    const res = await verify('000000')

    expect(res.status).toBe(429)
    expect(updateCalls).toEqual([])
  })

  it('verifies on the correct code', async () => {
    pendingRows = [pending()]

    const res = await verify('123456')

    expect(res.status).toBe(200)
    expect(updateCalls).toContainEqual({ attempts: 1, verified: true })
    expect(updateCalls.some((c) => c.phoneVerified === true)).toBe(true)
  })

  it('rejects when no OTP is outstanding', async () => {
    pendingRows = []

    const res = await verify('123456')

    expect(res.status).toBe(400)
    expect(updateCalls).toEqual([])
  })

  it('gives the same response for a wrong code and no pending OTP', async () => {
    pendingRows = [pending()]
    const wrong = await verify('000000')
    const wrongBody = await wrong.json()

    updateCalls = []
    pendingRows = []
    const absent = await verify('000000')
    const absentBody = await absent.json()

    // Must not reveal whether a code is outstanding.
    expect(wrong.status).toBe(absent.status)
    expect(wrongBody).toEqual(absentBody)
  })
})
