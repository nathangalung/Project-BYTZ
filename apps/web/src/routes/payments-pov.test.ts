// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as paymentsRoute from './_authenticated/payments/index'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const paymentsSource = readSource('./_authenticated/payments/index.tsx')

/**
 * The payments page only ever showed Total Spent, which is always zero for a
 * talent because the sum keys off owner projects, and dropped totalEarned
 * entirely, so a talent's earnings appeared nowhere. It also had no error
 * state, so a failed fetch read as an empty history.
 */
describe('payments page reflects the viewer role', () => {
  it('shows earnings to a talent', () => {
    expect(paymentsSource).toContain("role === 'talent'")
    expect(paymentsSource).toContain('total_earned')
  })

  it('handles a failed history fetch instead of showing an empty list', () => {
    expect(paymentsSource).toContain('historyError')
  })
})

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const USER = {
  id: 'u1',
  email: 'rina@kerjacus.id',
  name: 'Rina Wulandari',
  role: 'owner' as 'owner' | 'talent',
  locale: 'id' as const,
  phone: '+628123456789',
  avatarUrl: null as string | null,
}

function signIn(role: 'owner' | 'talent') {
  useAuthStore.setState({
    user: { ...USER, role },
    isAuthenticated: true,
    isLoading: false,
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((url: string) =>
    Promise.resolve({
      success: true,
      data: url.startsWith('/api/v1/payments/summary')
        ? { totalSpent: 0, totalEarned: 0, pending: 0, thisMonth: 0 }
        : { items: [], total: 0, page: 1, pageSize: 50 },
    }),
  )
})

afterEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

/**
 * BRD and PRD are bought by the owner who commissions them. A talent is never
 * charged for either, so the pills filtered a history that can never hold a
 * matching row and read as a bug in the ledger.
 */
describe('the BRD and PRD filter pills belong to the owner', () => {
  it('hides them from a talent', async () => {
    signIn('talent')

    await renderRoute(paymentsRoute, { path: '/payments' })

    expect(screen.queryByText('BRD Purchase')).toBeNull()
    expect(screen.queryByText('PRD Purchase')).toBeNull()
    // The filters a talent does need are still there.
    expect(screen.getByText('All Types')).toBeDefined()
    expect(screen.getByText('Escrow Release')).toBeDefined()
  })

  it('shows them to an owner', async () => {
    signIn('owner')

    await renderRoute(paymentsRoute, { path: '/payments' })

    expect(screen.getByText('BRD Purchase')).toBeDefined()
    expect(screen.getByText('PRD Purchase')).toBeDefined()
  })
})
