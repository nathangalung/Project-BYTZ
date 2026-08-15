// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as detailRoute from './project-detail.$projectId'

/**
 * The public face of one project, and the only page where a signed-in talent
 * can apply without an account dashboard in front of them.
 *
 * Two suites already read this file as text - `public-detail-resilience` and
 * `public-scope-render` - and neither mounts it, so the four load states, the
 * three viewer variants and the whole scope projection went unexecuted. The
 * load states are the point: a 404 here means private or deleted and must
 * render "not found", while a real failure must offer a retry. Conflating them
 * either hides a live project or retries forever against a project that will
 * never exist.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const fetchMock = vi.fn()

const PROJECT: Record<string, unknown> = {
  id: 'p-1',
  title: 'Toko Online Kopi',
  description: 'Marketplace kopi lokal untuk UMKM',
  category: 'web_app',
  status: 'matching',
  budgetMin: 5_000_000,
  budgetMax: 10_000_000,
  estimatedTimelineDays: 45,
  teamSize: 3,
  preferences: { requiredSkills: ['React', 'Node.js'] },
  createdAt: '2026-03-01T00:00:00.000Z',
}

const WORK_PACKAGES = [
  {
    id: 'wp-1',
    title: 'Backend API',
    description: 'Order and payment endpoints',
    requiredSkills: ['Node.js', 'PostgreSQL'],
  },
  { id: 'wp-2', title: 'Frontend', description: 'Storefront', requiredSkills: [] },
]

type Stub = { project?: unknown; projectStatus?: number; workPackages?: unknown }

/** One route per URL, so a test states only what it cares about. */
function stubApi({ project = PROJECT, projectStatus = 200, workPackages }: Stub = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes('/work-packages/')) {
      return workPackages === undefined
        ? Promise.resolve({ ok: false, json: async () => null })
        : Promise.resolve({ ok: true, json: async () => workPackages })
    }
    return Promise.resolve({
      ok: projectStatus < 400,
      status: projectStatus,
      json: async () => ({ data: project }),
    })
  })
}

function signInAs(role: 'owner' | 'talent') {
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@kerjacus.id', name: 'Ari', role, locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
}

function signOut() {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
}

/** The load chains a fetch, a json() and a Promise.all before it settles. */
async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const render = () =>
  renderRoute(detailRoute, {
    path: '/project-detail/$projectId',
    entry: '/project-detail/p-1',
    destinations: ['/browse-projects', '/register', '/login'],
  })

beforeEach(() => {
  fetchMock.mockReset()
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ success: true, data: { id: 'tp-1' } })
  stubApi()
  vi.stubGlobal('fetch', fetchMock)
  signOut()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the four load states', () => {
  it('spins while the project is still being fetched', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('Project not found')).toBeNull()
  })

  it('offers a retry and a way back when the fetch fails outright', async () => {
    stubApi({ projectStatus: 500 })

    await render()

    expect(await screen.findByText('Failed to load data')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back to project list' }).getAttribute('href')).toBe(
      '/browse-projects',
    )
  })

  it('loads the project when the retry succeeds', async () => {
    const user = userEvent.setup()
    stubApi({ projectStatus: 500 })
    await render()
    expect(await screen.findByText('Failed to load data')).toBeDefined()

    stubApi()
    await user.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })).toBeDefined()
  })

  /** 404 means private or deleted: a retry could only fail again. */
  it('reports a 404 as not found, with no retry on offer', async () => {
    stubApi({ projectStatus: 404 })

    await render()

    expect(await screen.findByText('Project not found')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to project list' })).toBeDefined()
  })

  it('reports an empty payload as not found too', async () => {
    stubApi({ project: null })

    await render()

    expect(await screen.findByText('Project not found')).toBeDefined()
  })

  it('renders the project once everything settles', async () => {
    await render()

    expect(await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })).toBeDefined()
    expect(screen.getByText('Marketplace kopi lokal untuk UMKM')).toBeDefined()
  })

  /**
   * A visitor who navigates away mid-flight leaves a promise in the air. The
   * effect flags itself cancelled so the late response writes nothing back
   * into a tree that is already gone.
   *
   * `settled` is asserted alongside the empty container because an unmounted
   * container is empty whatever the response did. Without it the test passes
   * just as happily when the promise never resolves at all, which would prove
   * nothing.
   *
   * Honest limit: React 19 ignores a setState on an unmounted component, so
   * deleting the `cancelled` guard would not fail this test. What it pins is
   * the lifecycle - a response arriving after unmount settles and renders
   * nothing - not the guard's necessity.
   */
  it('writes nothing back when the response lands after the visitor left', async () => {
    const held: Array<() => void> = []
    const settled = vi.fn()
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          held.push(() => {
            settled()
            resolve(
              String(url).includes('/work-packages/')
                ? { ok: true, json: async () => ({ success: true, data: WORK_PACKAGES }) }
                : { ok: true, status: 200, json: async () => ({ data: PROJECT }) },
            )
          })
        }),
    )
    const { container, unmount } = await render()

    unmount()
    for (const land of held) land()
    await settle()

    expect(settled).toHaveBeenCalledTimes(2)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText('Toko Online Kopi')).toBeNull()
  })

  it('does the same when the late response is a failure', async () => {
    const held: Array<() => void> = []
    const settled = vi.fn()
    fetchMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          held.push(() => {
            settled()
            reject(new Error('too late'))
          })
        }),
    )
    const { container, unmount } = await render()

    unmount()
    for (const fail of held) fail()
    await settle()

    expect(settled).toHaveBeenCalledTimes(2)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText('Failed to load data')).toBeNull()
  })
})

describe('the project summary', () => {
  it('states budget, timeline and team size', async () => {
    await render()

    expect(await screen.findByText(/Rp 5.000.000\s*-\s*Rp 10.000.000/)).toBeDefined()
    expect(screen.getByText(/45 days/)).toBeDefined()
    expect(screen.getByText(/3 people/)).toBeDefined()
  })

  it('assumes a team of one where the project does not say', async () => {
    stubApi({ project: { ...PROJECT, teamSize: undefined } })

    await render()

    expect(await screen.findByText(/1 people/)).toBeDefined()
  })

  it('translates the status', async () => {
    await render()

    expect(await screen.findByText('Matching')).toBeDefined()
  })

  it('falls back to the raw status when there is no translation', async () => {
    stubApi({ project: { ...PROJECT, status: 'weird_state' } })

    await render()

    expect(await screen.findByText('weird_state')).toBeDefined()
  })

  it('renders a project that carries neither a status nor a category', async () => {
    stubApi({ project: { ...PROJECT, status: undefined, category: undefined } })

    await render()

    expect(await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })).toBeDefined()
    expect(screen.queryByText('Matching')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Apply for Project' })).toBeNull()
  })

  it('lists the skills the owner asked for', async () => {
    await render()

    const section = (await screen.findByRole('heading', { name: 'Required Skills' }))
      .parentElement as HTMLElement
    expect(within(section).getByText('React')).toBeDefined()
    expect(within(section).getByText('Node.js')).toBeDefined()
  })

  it('leaves the skills section out when the preferences hold none', async () => {
    stubApi({ project: { ...PROJECT, preferences: { requiredSkills: 'not-an-array' } } })

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('heading', { name: 'Required Skills' })).toBeNull()
  })

  it('leaves it out when there are no preferences at all', async () => {
    stubApi({ project: { ...PROJECT, preferences: null } })

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('heading', { name: 'Required Skills' })).toBeNull()
  })

  it('says when the project was posted', async () => {
    await render()

    expect(await screen.findByText(/Posted/)).toBeDefined()
  })

  it('celebrates a finished project', async () => {
    stubApi({ project: { ...PROJECT, status: 'completed' } })

    await render()

    expect(await screen.findByText('Project Completed')).toBeDefined()
    expect(
      screen.getByText('This project has been successfully completed through KerjaCUS! platform'),
    ).toBeDefined()
  })
})

describe('the team composition', () => {
  it('names each work package and the skills it needs', async () => {
    stubApi({ workPackages: { success: true, data: WORK_PACKAGES } })

    await render()

    expect(await screen.findByRole('heading', { name: 'Team Composition' })).toBeDefined()
    expect(screen.getAllByText('Backend API')).toHaveLength(2)
    expect(screen.getByText('Order and payment endpoints')).toBeDefined()
    expect(screen.getByText('PostgreSQL')).toBeDefined()
  })

  /** Work packages are owner-gated; a 401 must not take the page down. */
  it('renders the page without them when the viewer may not see them', async () => {
    await render()

    expect(await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Team Composition' })).toBeNull()
  })

  it('ignores a payload that is not a list of packages', async () => {
    stubApi({ workPackages: { success: true, data: 'nope' } })

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('heading', { name: 'Team Composition' })).toBeNull()
  })

  it('ignores a payload whose envelope reports failure', async () => {
    stubApi({ workPackages: { success: false, data: WORK_PACKAGES } })

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('heading', { name: 'Team Composition' })).toBeNull()
  })

  it('renders the page when the work-package request throws', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/work-packages/')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ data: PROJECT }) }),
    )

    await render()

    expect(await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Team Composition' })).toBeNull()
  })

  it('copes with a package carrying no title', async () => {
    stubApi({ workPackages: { success: true, data: [{ id: 'wp-9', description: 'Mystery' }] } })

    await render()

    expect(await screen.findByText('?')).toBeDefined()
  })
})

describe('who gets an apply button', () => {
  it('sends a guest to registration', async () => {
    await render()

    const cta = await screen.findByRole('link', { name: 'Apply for Project' })
    expect(cta.getAttribute('href')).toBe('/register')
    expect(screen.getByText('Interested in this project?')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Register Now' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Already Have an Account' })).toBeDefined()
  })

  it('offers nothing to an owner browsing someone else’s project', async () => {
    signInAs('owner')

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Apply for Project' })).toBeNull()
    expect(screen.queryByText('Interested in this project?')).toBeNull()
  })

  it('offers nobody an apply button once the project is closed', async () => {
    stubApi({ project: { ...PROJECT, status: 'in_progress' } })

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('link', { name: 'Apply for Project' })).toBeNull()
    expect(screen.queryByText('Interested in this project?')).toBeNull()
  })

  it('lets a talent apply and confirms it afterwards', async () => {
    const user = userEvent.setup()
    signInAs('talent')
    await render()

    const button = await screen.findByRole('button', { name: 'Apply for Project' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await user.click(button)

    expect(await screen.findByRole('button', { name: 'Applied' })).toBeDefined()
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/applications',
      expect.objectContaining({ method: 'POST' }),
    )
    const applyCall = apiFetch.mock.calls.find(([url]) => url === '/api/v1/applications')
    expect(JSON.parse(String(applyCall?.[1].body))).toEqual({
      projectId: 'p-1',
      talentId: 'tp-1',
    })
  })

  it('will not let a talent apply twice', async () => {
    const user = userEvent.setup()
    signInAs('talent')
    await render()

    const button = await screen.findByRole('button', { name: 'Apply for Project' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await user.click(button)

    const applied = (await screen.findByRole('button', { name: 'Applied' })) as HTMLButtonElement
    expect(applied.disabled).toBe(true)
  })

  it('says it is applying while the request is in flight', async () => {
    const user = userEvent.setup()
    signInAs('talent')
    apiFetch.mockImplementation((url: string) =>
      url === '/api/v1/applications'
        ? new Promise(() => {})
        : Promise.resolve({ success: true, data: { id: 'tp-1' } }),
    )
    await render()

    const button = await screen.findByRole('button', { name: 'Apply for Project' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await user.click(button)

    const pending = (await screen.findByRole('button', {
      name: 'Applying...',
    })) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
  })

  it('holds the button shut until the talent profile has loaded', async () => {
    signInAs('talent')
    apiFetch.mockReturnValue(new Promise(() => {}))

    await render()

    const button = (await screen.findByRole('button', {
      name: 'Apply for Project',
    })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

/**
 * The scope block is served only for a public_detail project, and it is a
 * projection of the PRD with every money field removed. Each subsection hides
 * itself when empty rather than rendering a bare heading.
 */
describe('the published scope', () => {
  const FULL_SCOPE = {
    architecture: 'Modular monolith on Bun',
    techStack: [{ name: 'React', category: 'frontend', description: 'UI layer' }],
    workPackages: [
      {
        name: 'Checkout',
        requiredSkills: ['Stripe'],
        estimatedHours: 40,
        deliverables: [{ title: 'Payment flow', type: 'code' }],
        acceptanceCriteria: ['Handles a failed charge'],
      },
    ],
    sprintPlan: [{ name: 'Sprint 1', duration: '2 weeks', milestones: ['Auth', 'Catalog'] }],
    assumptions: ['Owner supplies the brand assets'],
    risks: ['Payment gateway approval may be slow'],
    totalEstimatedHours: 120,
  }

  it('is absent for a project that did not publish one', async () => {
    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    expect(screen.queryByRole('heading', { name: 'Architecture' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Sprint Plan' })).toBeNull()
  })

  it('renders every section when the project published a full scope', async () => {
    stubApi({ project: { ...PROJECT, scope: FULL_SCOPE } })

    await render()

    expect(await screen.findByRole('heading', { name: 'Architecture' })).toBeDefined()
    expect(screen.getByText('Modular monolith on Bun')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Tech Stack' })).toBeDefined()
    expect(screen.getByText('UI layer')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Work Packages' })).toBeDefined()
    expect(screen.getByText('120 Hours')).toBeDefined()
    expect(screen.getByText('40 Hours')).toBeDefined()
    expect(screen.getByText('Stripe')).toBeDefined()
    expect(screen.getByText('Payment flow')).toBeDefined()
    expect(screen.getByText('Handles a failed charge')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Sprint Plan' })).toBeDefined()
    expect(screen.getByText('Auth, Catalog')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Assumptions' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Risk Assessment' })).toBeDefined()
  })

  it('carries no money field anywhere in the scope block', async () => {
    stubApi({ project: { ...PROJECT, scope: FULL_SCOPE } })

    const { container } = await render()

    await screen.findByRole('heading', { name: 'Work Packages' })
    const scopeText = container.textContent ?? ''
    expect(scopeText).not.toMatch(/talent_payout|platform_fee|final_price/)
  })

  it('hides each subsection that came back empty', async () => {
    stubApi({
      project: {
        ...PROJECT,
        scope: {
          architecture: '',
          techStack: [],
          workPackages: [],
          sprintPlan: [],
          assumptions: [],
          risks: [],
          totalEstimatedHours: 0,
        },
      },
    })

    await render()

    await screen.findByRole('heading', { level: 1, name: 'Toko Online Kopi' })
    for (const heading of [
      'Architecture',
      'Tech Stack',
      'Work Packages',
      'Sprint Plan',
      'Assumptions',
      'Risk Assessment',
    ]) {
      expect(screen.queryByRole('heading', { name: heading })).toBeNull()
    }
  })

  it('omits the hour counts a scope did not estimate', async () => {
    stubApi({
      project: {
        ...PROJECT,
        scope: {
          ...FULL_SCOPE,
          totalEstimatedHours: 0,
          workPackages: [
            {
              name: 'Checkout',
              requiredSkills: [],
              estimatedHours: 0,
              deliverables: [],
              acceptanceCriteria: [],
            },
          ],
        },
      },
    })

    await render()

    expect(await screen.findByRole('heading', { name: 'Work Packages' })).toBeDefined()
    expect(screen.queryByText(/Hours/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Deliverables' })).toBeNull()
  })

  it('keeps risks when there are no assumptions to show beside them', async () => {
    stubApi({ project: { ...PROJECT, scope: { ...FULL_SCOPE, assumptions: [] } } })

    await render()

    expect(await screen.findByRole('heading', { name: 'Risk Assessment' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Assumptions' })).toBeNull()
  })

  it('keeps assumptions when there are no risks', async () => {
    stubApi({ project: { ...PROJECT, scope: { ...FULL_SCOPE, risks: [] } } })

    await render()

    expect(await screen.findByRole('heading', { name: 'Assumptions' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Risk Assessment' })).toBeNull()
  })

  it('drops a sprint row that lists no milestones', async () => {
    stubApi({
      project: {
        ...PROJECT,
        scope: {
          ...FULL_SCOPE,
          sprintPlan: [{ name: 'Sprint 1', duration: '2 weeks', milestones: [] }],
        },
      },
    })

    await render()

    expect(await screen.findByText('Sprint 1')).toBeDefined()
    expect(screen.queryByText('Auth, Catalog')).toBeNull()
  })
})
