// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, withQueryClient } from '@/lib/testing/harness'
import { ApiError } from '../lib/api'
import {
  useCreateSnapToken,
  usePaymentHistory,
  usePaymentSummary,
  useTransaction,
} from './use-payments'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, apiFetch }
})

let client: QueryClient

beforeEach(() => {
  apiFetch.mockReset()
  client = createTestQueryClient()
})

function renderWith<T>(hook: () => T) {
  return renderHook(hook, { wrapper: withQueryClient(client) })
}

describe('usePaymentSummary', () => {
  it('unwraps the running totals the dashboard shows', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: { totalSpent: 12_000_000, totalEarned: 0, pending: 3_000_000, thisMonth: 1_000_000 },
    })

    const { result } = renderWith(() => usePaymentSummary())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.totalSpent).toBe(12_000_000)
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/payments/summary')
  })

  it('surfaces a failure rather than rendering zeroes as fact', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))

    const { result } = renderWith(() => usePaymentSummary())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})

describe('usePaymentHistory', () => {
  it('requests the bare list when no filter is applied', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => usePaymentHistory())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/payments/list')
  })

  it('passes every supplied filter through as a query parameter', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() =>
      usePaymentHistory({ type: 'escrow_in', page: 2, pageSize: 50 }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = apiFetch.mock.calls[0][0] as string
    expect(url).toContain('type=escrow_in')
    expect(url).toContain('page=2')
    expect(url).toContain('pageSize=50')
  })

  /** Distinct filters must not read each other's cached page. */
  it('caches each filter combination separately', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const first = renderWith(() => usePaymentHistory({ type: 'refund' }))
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    const second = renderWith(() => usePaymentHistory({ type: 'escrow_in' }))
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))

    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

describe('useTransaction', () => {
  it('returns the row with its audit events and ledger legs', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        id: 'tx1',
        amount: 10_000_000,
        events: [{ id: 'e1', eventType: 'escrow_created' }],
        ledgerEntries: [{ id: 'l1', entryType: 'debit', amount: 10_000_000 }],
      },
    })

    const { result } = renderWith(() => useTransaction('tx1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.ledgerEntries).toHaveLength(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/payments/tx1')
  })

  it('stays idle until an id is available', () => {
    renderWith(() => useTransaction(''))

    expect(apiFetch).not.toHaveBeenCalled()
  })
})

/**
 * The browser posts what to buy, never the price: the payment service reads
 * the amount off the project and milestone rows. A body carrying an amount
 * would be an owner-editable invoice.
 */
describe('useCreateSnapToken', () => {
  it('returns the token and redirect the Snap widget needs', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: { token: 'snap-token', redirectUrl: 'https://app.sandbox.midtrans.com/x' },
    })

    const { result } = renderWith(() => useCreateSnapToken())
    result.current.mutate({
      projectId: 'p1',
      orderId: 'o1',
      checkoutType: 'brd',
      itemName: 'BRD',
      customerName: 'Owner',
      customerEmail: 'owner@kerjacus.id',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.token).toBe('snap-token')
  })

  it('sends no price in the request body', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { token: 't', redirectUrl: 'u' } })

    const { result } = renderWith(() => useCreateSnapToken())
    result.current.mutate({
      projectId: 'p1',
      orderId: 'o1',
      checkoutType: 'revision',
      milestoneId: 'm1',
      itemName: 'Revision',
      customerName: 'Owner',
      customerEmail: 'owner@kerjacus.id',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const sent = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(sent).not.toHaveProperty('amount')
    expect(sent.checkoutType).toBe('revision')
    expect(sent.milestoneId).toBe('m1')
  })

  it('reports a rejected checkout to the caller', async () => {
    apiFetch.mockRejectedValue(new ApiError('nope', 400, 'PAYMENT_INVALID_CHECKOUT'))

    const { result } = renderWith(() => useCreateSnapToken())
    result.current.mutate({
      projectId: 'p1',
      orderId: 'o1',
      checkoutType: 'brd',
      itemName: 'BRD',
      customerName: 'Owner',
      customerEmail: 'owner@kerjacus.id',
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).code).toBe('PAYMENT_INVALID_CHECKOUT')
  })
})
