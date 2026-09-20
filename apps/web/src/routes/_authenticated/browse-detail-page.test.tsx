// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as browseDetailRoute from './browse.$projectId'

/**
 * A signed-in talent opening a project from browse must stay in the app shell
 * and read the same detail, not the public page, so it never looks like a
 * logout. This route reuses ProjectDetailView with the authenticated back
 * target; the view itself is covered by the public detail suite.
 */

vi.setConfig({ testTimeout: 30_000 })

const fetchMock = vi.fn()

const PROJECT: Record<string, unknown> = {
  id: 'p-1',
  title: 'Toko Online Kopi',
  description: 'Marketplace kopi lokal',
  category: 'web_app',
  status: 'matching',
  payoutMin: 5_000_000,
  payoutMax: 10_000_000,
  openPositions: 2,
  estimatedTimelineDays: 45,
  preferences: { requiredSkills: ['React'] },
  createdAt: '2026-03-01T00:00:00.000Z',
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation((url: string) =>
    String(url).includes('/work-packages/')
      ? Promise.resolve({ ok: false, json: async () => null })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ data: PROJECT }) }),
  )
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@kerjacus.id', name: 'Ari', role: 'talent', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

describe('the authenticated browse detail', () => {
  it('renders the project and links back to the authenticated browse list', async () => {
    await renderRoute(browseDetailRoute, {
      path: '/browse/$projectId',
      entry: '/browse/p-1',
      destinations: ['/browse', '/register', '/login'],
    })

    expect(await screen.findByRole('heading', { name: 'Toko Online Kopi' })).toBeDefined()
    const back = await screen.findByRole('link', { name: /back|kembali/i })
    expect(back.getAttribute('href')).toBe('/browse')
  })
})
