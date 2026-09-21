// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as publicDetailRoute from '@/routes/_public/project-detail.$projectId'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

/**
 * "Lamar Proyek" on the project detail page showed a spinner and went back to
 * normal: the mutation carried an onSuccess and no onError, so a refusal - for
 * a talent who signed up without a CV, always a 422 - landed nowhere. The page
 * now decides before the click whether applying is possible, says why when it
 * is not, and shows the server's reason when the answer only arrives after.
 */

vi.setConfig({ testTimeout: 30_000 })

const PROJECT: Record<string, unknown> = {
  id: 'p-1',
  title: 'Toko Online Kopi',
  description: 'Marketplace kopi lokal',
  category: 'web_app',
  status: 'matching',
  ownerId: 'owner-9',
  payoutMin: 5_000_000,
  payoutMax: 10_000_000,
  openPositions: 2,
  estimatedTimelineDays: 45,
  preferences: { requiredSkills: ['React'] },
  createdAt: '2026-03-01T00:00:00.000Z',
}

const VERIFIED_PROFILE = {
  id: 't-1',
  userId: 'u1',
  cvFileUrl: 'https://cdn/cv.pdf',
  verificationStatus: 'verified',
}

type Stubs = {
  project?: Record<string, unknown>
  profile?: Record<string, unknown> | null
  applications?: Array<Record<string, unknown>>
  applyError?: { status: number; code: string }
}

const fetchMock = vi.fn()

function stubApi({
  project = PROJECT,
  profile = VERIFIED_PROFILE,
  applications = [],
  applyError,
}: Stubs = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = String(url)
    if (init?.method === 'POST' && path.includes('/applications')) {
      if (applyError) {
        return Promise.resolve({
          ok: false,
          status: applyError.status,
          json: async () => ({ error: { code: applyError.code } }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ success: true, data: { id: 'a-1' } }),
      })
    }
    if (path.includes('/applications/talent/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { items: applications, total: applications.length },
        }),
      })
    }
    if (path.includes('/talent-profiles/user/')) {
      if (!profile) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { code: 'TALENT_NOT_FOUND' } }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: profile }),
      })
    }
    if (path.includes('/work-packages/')) {
      return Promise.resolve({ ok: false, status: 403, json: async () => null })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: project }) })
  })
}

async function renderDetail() {
  return renderRoute(publicDetailRoute, {
    path: '/project-detail/$projectId',
    entry: '/project-detail/p-1',
    destinations: [
      '/browse-projects',
      '/register',
      '/login',
      '/talent/profile',
      '/talent/register',
    ],
  })
}

function signInAs(role: 'owner' | 'talent') {
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@kerjacus.id', name: 'Ari', role, locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useToastStore.setState({ toasts: [] })
  signInAs('talent')
  stubApi()
})

const applyButton = () => screen.findByRole('button', { name: /apply for project|lamar proyek/i })

describe('a verified talent applying', () => {
  it('sends the application with the talent profile id and confirms it', async () => {
    stubApi()
    await renderDetail()

    const button = await applyButton()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    await userEvent.click(button)

    await waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => t.type)).toContain('success')
    })
    const posted = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ projectId: 'p-1', talentId: 't-1' })
    expect(await screen.findByRole('button', { name: /applied|sudah melamar/i })).toBeDefined()
  })
})

describe('a refusal the talent could not have seen coming', () => {
  it('shows the reason instead of quietly re-enabling the button', async () => {
    // Nothing on the page said the seat had gone; only the POST finds out.
    stubApi({ applyError: { status: 409, code: 'CONFLICT' } })
    await renderDetail()

    const button = await applyButton()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    await userEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/already applied/i)
    expect(useToastStore.getState().toasts.map((t) => t.type)).toContain('error')
  })

  it('reads a closed project out of the server code', async () => {
    stubApi({ applyError: { status: 400, code: 'PROJECT_VALIDATION_INVALID_STATUS' } })
    await renderDetail()

    await userEvent.click(await applyButton())

    expect((await screen.findByRole('alert')).textContent).toMatch(/no longer accepting/i)
  })

  it('falls back to the localized message for a code with no wording of its own', async () => {
    stubApi({ applyError: { status: 500, code: 'INTERNAL_ERROR' } })
    await renderDetail()

    await userEvent.click(await applyButton())

    expect((await screen.findByRole('alert')).textContent).toMatch(/went wrong|error/i)
  })
})

describe('the button reflects what the server would say', () => {
  it('tells a talent with no CV to upload one, and links to the profile', async () => {
    stubApi({
      profile: { ...VERIFIED_PROFILE, cvFileUrl: null, verificationStatus: 'unverified' },
    })
    await renderDetail()

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toMatch(/upload your cv/i)
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/talent/profile')
    expect((await applyButton()).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('waits for a CV that is still being verified', async () => {
    stubApi({ profile: { ...VERIFIED_PROFILE, verificationStatus: 'cv_parsing' } })
    await renderDetail()

    expect((await screen.findByRole('status')).textContent).toMatch(/being processed/i)
    expect((await applyButton()).hasAttribute('disabled')).toBe(true)
  })

  it('sends a talent with no profile to finish signing up', async () => {
    stubApi({ profile: null })
    await renderDetail()

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toMatch(/complete your talent profile/i)
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/talent/register')
    expect(screen.queryByRole('button', { name: /apply for project/i })).toBeNull()
  })

  it('stops a suspended talent with no button at all', async () => {
    stubApi({ profile: { ...VERIFIED_PROFILE, verificationStatus: 'suspended' } })
    await renderDetail()

    expect((await screen.findByRole('status')).textContent).toMatch(/suspended/i)
    expect(screen.queryByRole('button', { name: /apply for project/i })).toBeNull()
  })

  it('shows a live application as already applied', async () => {
    stubApi({ applications: [{ id: 'a-1', projectId: 'p-1', status: 'pending' }] })
    await renderDetail()

    expect(await screen.findByRole('button', { name: /applied|sudah melamar/i })).toBeDefined()
    expect((await screen.findByRole('status')).textContent).toMatch(/already applied/i)
  })

  /**
   * The server stopped counting withdrawn rows so a talent who withdrew by
   * mistake can apply again. A client that counted them would put that dead
   * end straight back.
   */
  it('lets a talent who withdrew apply again', async () => {
    stubApi({ applications: [{ id: 'a-1', projectId: 'p-1', status: 'withdrawn' }] })
    await renderDetail()

    const button = await applyButton()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  })

  /**
   * A projection that carried no seat figures at all must not read as a full
   * project: that would disable applying everywhere the fields were missing.
   */
  it('still lets a talent apply when the projection carried no seat figures', async () => {
    const { openPositions, payoutMin, payoutMax, ...bare } = PROJECT
    stubApi({ project: bare })
    await renderDetail()

    const button = await applyButton()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says so when every seat on the project is taken', async () => {
    stubApi({ project: { ...PROJECT, openPositions: 0 } })
    await renderDetail()

    expect((await screen.findByRole('status')).textContent).toMatch(/already filled/i)
    expect((await applyButton()).hasAttribute('disabled')).toBe(true)
  })

  it('refuses an owner viewing their own open project', async () => {
    signInAs('talent')
    stubApi({ project: { ...PROJECT, ownerId: 'u1' } })
    await renderDetail()

    expect((await screen.findByRole('status')).textContent).toMatch(/your own project/i)
    expect(screen.queryByRole('button', { name: /apply for project/i })).toBeNull()
  })
})
