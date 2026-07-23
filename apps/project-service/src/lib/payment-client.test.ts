import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseMilestoneEscrow } from './payment-client'

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
      performedBy: 'owner-1',
    })
  })

  it('keys idempotency on the milestone so a retry or auto-release cannot double pay', async () => {
    const mockFetch = okFetch()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await releaseMilestoneEscrow({
      milestoneId: 'ms-9',
      projectId: 'p',
      talentId: 't',
      amount: 1,
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
        performedBy: 'system',
      }),
    ).rejects.toThrow(/insufficient escrow/)
  })
})
