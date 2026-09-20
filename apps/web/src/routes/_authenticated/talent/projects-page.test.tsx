// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as projectsRoute from './projects'

/**
 * The talent counterpart to the owner's My Projects. It reads the projects the
 * talent is staffed on, so its four states matter: a failed fetch must not read
 * as an empty roster, and an empty roster must offer the way to browse.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROFILE = { id: 'tp-1', userId: 'u1', verificationStatus: 'verified' }
const PROJECT = {
  id: 'p-1',
  title: 'Marketplace UMKM',
  progress: 40,
  currentMilestone: 'Backend API',
  deadline: '2026-06-01T00:00:00.000Z',
}

/** Profile always resolves; the active-projects response is what each test sets. */
function stub(active: 'ok' | 'empty' | 'error' | 'loading', projects = [PROJECT]) {
  apiFetch.mockImplementation((url: string) => {
    if (String(url).includes('/active-projects')) {
      if (active === 'loading') return new Promise(() => {})
      if (active === 'error') return Promise.reject(new Error('boom'))
      return Promise.resolve({ success: true, data: active === 'empty' ? [] : projects })
    }
    return Promise.resolve({ success: true, data: PROFILE })
  })
}

function render() {
  return renderRoute(projectsRoute, {
    path: '/talent/projects',
    entry: '/talent/projects',
    destinations: ['/projects/$projectId', '/browse'],
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@kerjacus.id', name: 'Ari', role: 'talent', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

describe('the talent My Projects page', () => {
  it('lists the staffed projects with their milestone and progress', async () => {
    stub('ok')

    await render()

    expect(await screen.findByRole('heading', { name: 'Marketplace UMKM' })).toBeDefined()
    expect(screen.getByText('Backend API')).toBeDefined()
    expect(screen.getByText('40%')).toBeDefined()
  })

  it('shows a skeleton while the projects are loading', async () => {
    stub('loading')

    const { container } = await render()

    // The skeleton shows once the profile resolves and the projects query,
    // enabled by it, starts fetching.
    await waitFor(() => expect(container.querySelector('.animate-pulse')).not.toBeNull())
  })

  it('reports a failed load rather than an empty roster', async () => {
    stub('error')

    await render()

    expect(await screen.findByRole('button', { name: /try again|coba lagi/i })).toBeDefined()
  })

  it('offers the way to browse when the roster is empty', async () => {
    stub('empty')

    await render()

    const browse = await screen.findByRole('link', { name: /browse|jelajahi/i })
    expect(browse.getAttribute('href')).toBe('/browse')
  })
})
