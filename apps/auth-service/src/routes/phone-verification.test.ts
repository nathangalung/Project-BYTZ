import { phoneVerifications } from '@kerjacus/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drive the real handler. The rest of this suite mirrors logic into local
// copies, which is exactly how the attempt-counter bug survived: a mirrored
// test passes even when the route it mirrors is broken.

const SESSION_USER = { id: 'user-1', name: 'Test', email: 't@e.st', role: 'owner' }

type UpdateCall = { attempts?: number; verified?: boolean; phoneVerified?: boolean }
type InsertedOtp = { code?: string; phone?: string; userId?: string; expiresAt?: Date }

let pendingRows: Array<Record<string, unknown>> = []
let userRows: Array<Record<string, unknown>> = []
let updateCalls: UpdateCall[] = []
let inserted: InsertedOtp[] = []

const sendOtp = vi.fn()

// Two tables, two row sets. Reading the OTP rows for a query against `user`
// would let a request-otp test pass on rows /verify put there.
function makeFakeDb() {
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const rows = async () => (table === phoneVerifications ? pendingRows : userRows)
        return {
          where: () => ({
            orderBy: () => ({ limit: rows }),
            limit: rows,
          }),
        }
      },
    }),
    update: () => ({
      set: (values: UpdateCall) => {
        updateCalls.push(values)
        return { where: async () => undefined }
      },
    }),
    insert: () => ({
      values: async (row: InsertedOtp) => {
        inserted.push(row)
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => cb(db),
  }
  return db
}

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => makeFakeDb(),
}))

vi.mock('../lib/sms', () => ({ sendOtp }))

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

type Body = {
  success: boolean
  data?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

function verify(code: string) {
  return phoneVerificationRoute.request('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

function requestOtp() {
  return phoneVerificationRoute.request('/request-otp', { method: 'POST' })
}

beforeEach(() => {
  pendingRows = []
  userRows = []
  updateCalls = []
  inserted = []
  sendOtp.mockReset()
  sendOtp.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
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

  /** The exact cap. Four spent leaves one, and spending it reaches five. */
  it('still charges the fifth attempt, and only refuses from the sixth', async () => {
    pendingRows = [pending({ attempts: 4 })]

    const res = await verify('000000')

    expect(res.status).toBe(400)
    expect(updateCalls).toEqual([{ attempts: 5 }])
  })

  it('verifies on the correct code', async () => {
    pendingRows = [pending()]

    const res = await verify('123456')

    expect(res.status).toBe(200)
    expect(updateCalls).toContainEqual({ attempts: 1, verified: true })
    expect(updateCalls.some((c) => c.phoneVerified === true)).toBe(true)
  })

  /** A correct code on the last attempt has to still work. */
  it('accepts the correct code on the final attempt', async () => {
    pendingRows = [pending({ attempts: 4 })]

    const res = await verify('123456')

    expect(res.status).toBe(200)
    expect(updateCalls).toContainEqual({ attempts: 5, verified: true })
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

  it('rejects a code that is not six digits before touching the row', async () => {
    pendingRows = [pending()]

    const res = await verify('12345')

    expect(res.status).toBe(400)
    expect(updateCalls).toEqual([])
  })
})

describe('POST /request-otp', () => {
  const withPhone = (phone: string | null = '+628123456789') => {
    userRows = [{ phone }]
  }

  it('stores a six-digit code and sends that same code', async () => {
    withPhone()

    const res = await requestOtp()
    const body = (await res.json()) as Body

    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.code).toMatch(/^\d{6}$/)
    expect(inserted[0]?.userId).toBe(SESSION_USER.id)
    expect(inserted[0]?.phone).toBe('+628123456789')
    // A stored code that differs from the sent one can never be verified.
    expect(sendOtp).toHaveBeenCalledWith('+628123456789', inserted[0]?.code)
    expect(body.data?.expiresInSeconds).toBe(300)
  })

  /**
   * The five-minute window, at the point it is written. The read side filters
   * on expiresAt in SQL, which a fake database cannot exercise - see the note
   * in the report.
   */
  it('sets the expiry five minutes out', async () => {
    withPhone()
    const before = Date.now()

    await requestOtp()

    const expiresAt = inserted[0]?.expiresAt as Date
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(5 * 60 * 1000)
    expect(expiresAt.getTime() - before).toBeLessThan(5 * 60 * 1000 + 5_000)
  })

  it('draws a different code each time', async () => {
    withPhone()

    await requestOtp()
    await requestOtp()
    await requestOtp()

    expect(new Set(inserted.map((row) => row.code)).size).toBeGreaterThan(1)
  })

  it('refuses an account with no phone number, and stores nothing', async () => {
    withPhone(null)

    const res = await requestOtp()
    const body = (await res.json()) as Body

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('VALIDATION_ERROR')
    // A row with no destination is an OTP nobody can receive but everyone can guess at.
    expect(inserted).toEqual([])
    expect(sendOtp).not.toHaveBeenCalled()
  })

  it('refuses when the session outlives the user row', async () => {
    userRows = []

    const res = await requestOtp()

    expect(res.status).toBe(400)
    expect(inserted).toEqual([])
  })

  /**
   * devCode exists so a developer can read the code without an SMS gateway.
   * In production it would hand the OTP straight back to the caller, which
   * defeats possession of the phone entirely.
   */
  it('does not return the code in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    withPhone()

    const res = await requestOtp()
    const body = (await res.json()) as Body

    expect(res.status).toBe(200)
    expect(body.data).not.toHaveProperty('devCode')
    expect(JSON.stringify(body)).not.toContain(String(inserted[0]?.code))
  })

  it('returns the code outside production, matching the stored one', async () => {
    withPhone()

    const res = await requestOtp()
    const body = (await res.json()) as Body

    expect(body.data?.devCode).toBe(inserted[0]?.code)
  })

  it('logs a failed send in production and still reports success to the caller', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    withPhone()
    sendOtp.mockResolvedValue({ success: false, error: 'gateway down' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await requestOtp()

    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('+628123456789'),
      expect.stringContaining('gateway down'),
    )
  })

  it('does not log a failed send outside production, where the console fallback is the delivery', async () => {
    withPhone()
    sendOtp.mockResolvedValue({ success: false, error: 'gateway down' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await requestOtp()

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('GET /status', () => {
  it('reports the stored phone and its verification flag', async () => {
    userRows = [{ phone: '+628123456789', phoneVerified: true }]

    const res = await phoneVerificationRoute.request('/status')
    const body = (await res.json()) as Body

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ phone: '+628123456789', phoneVerified: true })
  })

  /** Absent must read as unverified, never as verified-by-default. */
  it('reports no phone and unverified when the row is missing', async () => {
    userRows = []

    const res = await phoneVerificationRoute.request('/status')
    const body = (await res.json()) as Body

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ phone: null, phoneVerified: false })
  })

  it('reports unverified when the row carries a phone but no flag', async () => {
    userRows = [{ phone: '+628123456789', phoneVerified: null }]

    const res = await phoneVerificationRoute.request('/status')
    const body = (await res.json()) as Body

    expect(body.data).toEqual({ phone: '+628123456789', phoneVerified: false })
  })
})

/**
 * The OTP is the whole of phone verification. Returning it in the response
 * that requests it makes the step self-service: anyone who can call the
 * endpoint for a number can read the code back and verify it.
 *
 * It shipped that way. The guard read process.env.NODE_ENV, which bun build
 * substitutes at bundle time, and the Docker build runs before NODE_ENV is
 * set, so the ternary folded to the development branch and `devCode: code`
 * was unconditional in the production bundle.
 *
 * These assertions run against the real handler and flip the environment
 * between them, so a value fixed at build time cannot satisfy both.
 */
describe('otp is not echoed to the caller in production', () => {
  const original = process.env['NODE_ENV']

  afterEach(() => {
    if (original === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = original
  })

  it('withholds the code in production', async () => {
    process.env['NODE_ENV'] = 'production'
    userRows = [{ phone: '+628123456789' }]
    sendOtp.mockResolvedValue({ success: true })

    const body = (await (await requestOtp()).json()) as Body
    expect(body.success).toBe(true)
    expect(body.data).not.toHaveProperty('devCode')
    expect(JSON.stringify(body)).not.toContain(inserted[0]?.code ?? 'no-code')
  })

  it('still returns it in development, where it saves a real SMS', async () => {
    process.env['NODE_ENV'] = 'development'
    userRows = [{ phone: '+628123456789' }]
    sendOtp.mockResolvedValue({ success: true })

    const body = (await (await requestOtp()).json()) as Body
    expect(body.data?.devCode).toBe(inserted[0]?.code)
  })
})
