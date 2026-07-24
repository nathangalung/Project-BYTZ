import { getDb } from '@kerjacus/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refundRemainingEscrow } from './escrow-refund'
import { getEscrowBalance, refundEscrow } from './payment-client'

vi.mock('@kerjacus/db', () => ({ getDb: vi.fn(), transactions: {} }))
vi.mock('@kerjacus/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('./payment-client', () => ({ getEscrowBalance: vi.fn(), refundEscrow: vi.fn() }))

const balanceMock = getEscrowBalance as unknown as ReturnType<typeof vi.fn>
const refundMock = refundEscrow as unknown as ReturnType<typeof vi.fn>

function stubDeposits(rows: Array<{ id: string; amount: number }>) {
  ;(getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: () => ({ from: () => ({ where: async () => rows }) }),
  })
}

const input = {
  projectId: 'p1',
  ownerId: 'o1',
  performedBy: 'o1',
  idempotencyKeyPrefix: 'refund:cancel:p1',
  reason: 'Project cancelled by owner',
}

describe('refundRemainingEscrow', () => {
  afterEach(() => vi.clearAllMocks())

  it('does nothing when no escrow is held', async () => {
    balanceMock.mockResolvedValue(0)

    const result = await refundRemainingEscrow(input)

    expect(result.refunded).toBe(0)
    expect(refundMock).not.toHaveBeenCalled()
  })

  it('refunds the remaining balance, not the original deposit', async () => {
    // 10M deposited, 4M already released: only 6M comes back.
    balanceMock.mockResolvedValue(6_000_000)
    stubDeposits([{ id: 'txn-esc', amount: 10_000_000 }])

    const result = await refundRemainingEscrow(input)

    expect(result.refunded).toBe(6_000_000)
    expect(refundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTransactionId: 'txn-esc',
        amount: 6_000_000,
        idempotencyKey: 'refund:cancel:p1:txn-esc',
      }),
    )
  })

  it('spreads the balance across deposits, capped per deposit', async () => {
    balanceMock.mockResolvedValue(7_000_000)
    stubDeposits([
      { id: 'txn-a', amount: 5_000_000 },
      { id: 'txn-b', amount: 5_000_000 },
    ])

    const result = await refundRemainingEscrow(input)

    expect(result.refunded).toBe(7_000_000)
    expect(refundMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ originalTransactionId: 'txn-a', amount: 5_000_000 }),
    )
    expect(refundMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ originalTransactionId: 'txn-b', amount: 2_000_000 }),
    )
  })

  it('skips quietly when a balance exists but no deposit rows do', async () => {
    balanceMock.mockResolvedValue(1_000_000)
    stubDeposits([])

    const result = await refundRemainingEscrow(input)

    expect(result.refunded).toBe(0)
    expect(refundMock).not.toHaveBeenCalled()
  })
})
