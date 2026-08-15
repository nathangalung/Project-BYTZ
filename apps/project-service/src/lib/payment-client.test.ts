import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEscrowBalance, releaseMilestoneEscrow } from './payment-client'

/**
 * feeAmount decides the 3-leg ledger split at release: the payment service
 * debits talent_payout_account by amount and platform_revenue_account by
 * feeAmount. These tests once omitted it from every payload and still passed,
 * because tsconfig.json excludes test files from `tsc --noEmit`, so the call
 * typechecked nowhere and JSON.stringify dropped the undefined silently. The
 * body assertions below now pin the field the split depends on.
 */

const originalFetch = globalThis.fetch

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) })
}

describe('releaseMilestoneEscrow', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('posts to the payment release route with service auth', async () => {
    const mockFetch = okFetch()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await releaseMilestoneEscrow({
      milestoneId: 'ms-1',
      projectId: 'proj-1',
      talentId: 'talent-1',
      amount: 50000,
      feeAmount: 15000,
      performedBy: 'owner-1',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/v1/payments/release')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Service-Auth']).toBe(
      'test-service-auth-secret',
    )
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      milestoneId: 'ms-1',
      projectId: 'proj-1',
      talentId: 'talent-1',
      amount: 50000,
      feeAmount: 15000,
      performedBy: 'owner-1',
    })
  })

  // Platform revenue leg is booked from this field.
  it('forwards the fee so the release books a platform revenue leg', async () => {
    const mockFetch = okFetch()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await releaseMilestoneEscrow({
      milestoneId: 'ms-2',
      projectId: 'p',
      talentId: 't',
      amount: 5_150_000,
      feeAmount: 4_850_000,
      performedBy: 'system',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.feeAmount).toBe(4_850_000)
    expect(body.amount + body.feeAmount).toBe(10_000_000)
  })

  it('sends a zero fee rather than omitting it when the platform takes nothing', async () => {
    const mockFetch = okFetch()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await releaseMilestoneEscrow({
      milestoneId: 'ms-3',
      projectId: 'p',
      talentId: 't',
      amount: 1000,
      feeAmount: 0,
      performedBy: 'system',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).toHaveProperty('feeAmount')
    expect(body.feeAmount).toBe(0)
  })

  it('keys idempotency on the milestone so a retry or auto-release cannot double pay', async () => {
    const mockFetch = okFetch()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await releaseMilestoneEscrow({
      milestoneId: 'ms-9',
      projectId: 'p',
      talentId: 't',
      amount: 1,
      feeAmount: 0,
      performedBy: 'system',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.idempotencyKey).toBe('release:ms-9')
  })

  it('throws when the payment service rejects the release', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: { message: 'insufficient escrow' } }),
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await expect(
      releaseMilestoneEscrow({
        milestoneId: 'ms-1',
        projectId: 'p',
        talentId: 't',
        amount: 1,
        feeAmount: 0,
        performedBy: 'system',
      }),
    ).rejects.toThrow(/insufficient escrow/)
  })
})

/**
 * The balance gates whether a project may start, so the shape the payment
 * service answers with decides it. An unfunded project has no escrow account
 * yet, and the two ways that reaches here - an envelope with no data, and data
 * with no balance - both have to read as zero rather than as NaN or undefined,
 * either of which compares false against every threshold and would let an
 * unfunded project through.
 */
describe('getEscrowBalance', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function respond(body: unknown) {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch
  }

  it('reads the balance the payment service reports', async () => {
    respond({ success: true, data: { balance: 10_000_000 } })

    expect(await getEscrowBalance('proj-1')).toBe(10_000_000)
  })

  it('reads an unfunded project as zero when the envelope carries no data', async () => {
    respond({ success: true })

    expect(await getEscrowBalance('proj-1')).toBe(0)
  })

  it('reads an unfunded project as zero when data carries no balance', async () => {
    respond({ success: true, data: {} })

    expect(await getEscrowBalance('proj-1')).toBe(0)
  })

  it('escapes the project id into the path', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { balance: 0 } }) })
    globalThis.fetch = spy as unknown as typeof fetch

    await getEscrowBalance('proj/../admin')

    expect(spy.mock.calls[0][0]).toContain('/escrow-balance/proj%2F..%2Fadmin')
  })
})
