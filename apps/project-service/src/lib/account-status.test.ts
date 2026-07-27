import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The row behind the cookie. One left join, so a suspended talent and a
 * soft-deleted user are both answered without a second round trip.
 */
let rows: Array<{ deletedAt: Date | null; verificationStatus: string | null }> = []

vi.mock('@kerjacus/db', async (importOriginal) => {
  const node: Record<string, unknown> = {
    leftJoin: () => node,
    where: () => node,
    limit: async () => rows,
  }
  return {
    ...(await importOriginal<typeof import('@kerjacus/db')>()),
    getDb: () => ({ select: () => ({ from: () => node }) }),
  }
})

const { getAccountStatus } = await import('./account-status')

beforeEach(() => {
  rows = []
})

describe('getAccountStatus', () => {
  it('admits an owner with no talent profile', async () => {
    rows = [{ deletedAt: null, verificationStatus: null }]
    expect(await getAccountStatus('u1')).toBe('active')
  })

  it('admits a talent still verified', async () => {
    rows = [{ deletedAt: null, verificationStatus: 'verified' }]
    expect(await getAccountStatus('u1')).toBe('active')
  })

  // Unverified is a talent who has not finished CV parsing, not a punishment.
  it('admits a talent who is not verified yet', async () => {
    rows = [{ deletedAt: null, verificationStatus: 'unverified' }]
    expect(await getAccountStatus('u1')).toBe('active')
  })

  it('reports a suspended talent', async () => {
    rows = [{ deletedAt: null, verificationStatus: 'suspended' }]
    expect(await getAccountStatus('u1')).toBe('suspended')
  })

  it('reports a soft-deleted account as gone', async () => {
    rows = [{ deletedAt: new Date(), verificationStatus: 'verified' }]
    expect(await getAccountStatus('u1')).toBe('gone')
  })

  // A cookie naming a user who is no longer there is not a valid session.
  it('reports a user that no longer exists as gone', async () => {
    rows = []
    expect(await getAccountStatus('u1')).toBe('gone')
  })
})
