// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as prdRoute from './prd'

/**
 * The technical document, and the last screen before an owner funds escrow.
 *
 * Assigned talents read this page as their brief, so every owner decision on
 * it - approve, buy, proceed to development, request a revision - is hidden
 * from them by a single `isOwnerViewer` flag. Nothing had ever executed this
 * file: it reported zero statements, so the flag was unverified.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = { id: 'p-1', title: 'Toko Online Batik', status: 'prd_generated' }
const BRD = { id: 'b-1', status: 'approved', version: 1, content: { scope: 'Web app' } }

const PRD = {
  id: 'd-1',
  status: 'review',
  version: 3,
  paidAt: null as string | null,
  content: {
    tech_stack: [{ category: 'backend', name: 'Hono', reason: 'Cepat' }],
    total_cost: 12_000_000,
    total_estimated_hours: 480,
    team_composition: {
      team_size: 2,
      work_packages: [
        {
          title: 'Backend API',
          required_skills: ['Go'],
          estimated_hours: 240,
          amount: 6_000_000,
        },
      ],
    },
  },
}

function stubApi({
  prd = PRD as unknown,
  brd = BRD as unknown,
  project = PROJECT as unknown,
} = {}) {
  apiFetch.mockImplementation(async (url: string) => {
    const path = String(url)
    if (path.endsWith('/prd')) return { success: true, data: prd }
    if (path.endsWith('/brd')) return { success: true, data: brd }
    return { success: true, data: project }
  })
}

/** The revision request bypasses apiFetch and posts with raw fetch. */
function stubRevision({ status = 200, code }: { status?: number; code?: string } = {}) {
  const fetchMock = vi.fn(
    async () =>
      new Response(code ? JSON.stringify({ error: { code } }) : JSON.stringify({ data: {} }), {
        status,
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const OWNER = { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' }

function signIn(role: string | undefined) {
  useAuthStore.setState({
    user: { ...OWNER, role } as never,
    isAuthenticated: true,
    isLoading: false,
  })
}

function render() {
  return renderRoute(prdRoute, {
    path: '/projects/$projectId/prd',
    entry: '/projects/p-1/prd',
    destinations: ['/projects', '/projects/$projectId', '/projects/$projectId/checkout'],
  })
}

function toastMessages() {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  stubRevision()
  useToastStore.setState({ toasts: [] })
  signIn('owner')
  vi.stubGlobal('open', vi.fn())
})

describe('before the document exists', () => {
  it('says it is loading rather than showing an empty document', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    await render()

    expect(screen.getByText('Loading PRD document...')).toBeDefined()
  })

  it('offers to generate one when there is none yet', async () => {
    stubApi({ prd: null })

    await render()

    expect(await screen.findByRole('heading', { name: 'PRD not created yet' })).toBeDefined()
    expect(screen.getByRole('button', { name: /Generate PRD/ })).toBeDefined()
  })

  /** The PRD is derived from the BRD, so without one there is nothing to derive. */
  it('refuses to generate a PRD with no BRD to derive it from', async () => {
    stubApi({ prd: null, brd: null })

    await render()

    expect(
      (await screen.findByRole('button', { name: /Generate PRD/ })).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByText('The BRD must be approved before you can generate the PRD'),
    ).toBeDefined()
  })

  it('generates the PRD in the language the owner picked', async () => {
    stubApi({ prd: null })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'English' }))
    await user.click(screen.getByRole('button', { name: /Generate PRD/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/generate-prd',
        expect.objectContaining({ body: JSON.stringify({ language: 'en' }) }),
      ),
    )
    expect(toastMessages()).toContain('PRD generated')
  })

  it('reports why generation was refused', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/generate-prd')) throw new Error('Daily free limit reached')
      if (path.endsWith('/prd')) return { success: true, data: null }
      if (path.endsWith('/brd')) return { success: true, data: BRD }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Generate PRD/ }))

    await waitFor(() => expect(toastMessages()).toContain('Daily free limit reached'))
  })
})

/**
 * Reads the figure under one of the three summary cards. The document body
 * below repeats each work package's own amount and hours, so an unscoped
 * query matches whichever comes first.
 */
async function summaryValue(label: string) {
  const labels = await screen.findAllByText(label)
  // The three summary cards are rendered above the document body, which
  // repeats both the label and each package's own figures further down.
  // Intl separates "Rp" from the digits with a non-breaking space, which
  // getByText normalises away but textContent does not.
  return labels[0].nextElementSibling?.textContent?.replace(/ /g, ' ')
}

describe('reading the document', () => {
  it('summarises what the project will cost, take and need', async () => {
    await render()

    expect(await summaryValue('Total Cost')).toBe('Rp 12.000.000')
    expect(await summaryValue('Estimated Hours')).toBe('480')
    expect(await summaryValue('Team Size')).toBe('2')
  })

  it('shows the version and the project it belongs to', async () => {
    await render()

    expect(await screen.findByText('Toko Online Batik')).toBeDefined()
    expect(screen.getByText(/Version\s*3/)).toBeDefined()
  })

  /**
   * The generator does not always declare a total. Falling back to the sum of
   * the work packages is what stops the owner being shown Rp 0 for a project
   * that in fact costs millions.
   */
  it('totals the work packages when the generator declared no total', async () => {
    stubApi({
      prd: {
        ...PRD,
        content: {
          team_composition: {
            work_packages: [
              { title: 'Backend API', estimated_hours: 240, amount: 6_000_000 },
              { title: 'Frontend', estimated_hours: 160, amount: 4_000_000 },
            ],
          },
        },
      },
    })

    await render()

    // Scoped to the summary card: the body repeats each package's own amount.
    expect(await summaryValue('Total Cost')).toBe('Rp 10.000.000')
    expect(await summaryValue('Estimated Hours')).toBe('400')
    // No declared team size either, so it counts the packages.
    expect(await summaryValue('Team Size')).toBe('2')
  })
})

/**
 * The owner decision controls. A talent assigned to this project reads the
 * same page as their brief and must not be able to approve it, buy it, or
 * fund development.
 */
describe('the owner decisions and who is offered them', () => {
  const OWNER_CONTROLS = [
    'Approve PRD',
    'Request Revision',
    'Buy PRD Only',
    'Proceed to Development',
  ]

  it('offers an owner every decision control', async () => {
    await render()

    for (const name of OWNER_CONTROLS) {
      expect(await screen.findByRole('button', { name: new RegExp(name) })).toBeDefined()
    }
  })

  it('withholds every decision control from a talent', async () => {
    signIn('talent')

    await render()

    expect(
      await screen.findByRole('heading', { name: 'Product Requirement Document' }),
    ).toBeDefined()
    for (const name of OWNER_CONTROLS) {
      expect(screen.queryByRole('button', { name: new RegExp(name) })).toBeNull()
    }
  })

  /**
   * `isOwnerViewer` is `role !== 'talent'`, so it fails open: before the auth
   * store hydrates, `role` is undefined and a viewer is handed the owner's
   * decision controls. Recorded as current behaviour; it is a finding.
   */
  it('hands the owner decisions to a viewer whose role has not loaded yet', async () => {
    signIn(undefined)

    await render()

    expect(await screen.findByRole('button', { name: /Approve PRD/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Proceed to Development/ })).toBeDefined()
  })
})

describe('the paywall on downloading', () => {
  it('offers an owner only the unlock route while the PRD is unpaid', async () => {
    await render()

    expect(
      (await screen.findByRole('link', { name: /Unlock & download/ })).getAttribute('href'),
    ).toBe('/projects/p-1/checkout?type=prd')
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull()
  })

  it('offers the download once the PRD is paid for', async () => {
    stubApi({ prd: { ...PRD, paidAt: '2026-03-01T00:00:00.000Z' } })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Download PDF/ }))

    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/p-1/prd/pdf'),
      '_blank',
    )
  })

  it('offers a talent neither the unlock nor the download', async () => {
    stubApi({ prd: { ...PRD, paidAt: '2026-03-01T00:00:00.000Z' } })
    signIn('talent')

    await render()

    expect(
      await screen.findByRole('heading', { name: 'Product Requirement Document' }),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Unlock & download/ })).toBeNull()
  })
})

describe('approving the PRD', () => {
  it('records the approval on the project', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Approve PRD/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'prd_approved' }) }),
      ),
    )
  })

  it('survives a refused approval without crashing the page', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/transition')) throw new Error('invalid status')
      if (path.endsWith('/prd')) return { success: true, data: PRD }
      if (path.endsWith('/brd')) return { success: true, data: BRD }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Approve PRD/ }))

    expect(await screen.findByRole('button', { name: /Approve PRD/ })).toBeDefined()
  })
})

describe('buying the PRD outright', () => {
  it('sends an unpaid owner to checkout rather than marking it purchased', async () => {
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Buy PRD Only/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/checkout'))
    expect(router.state.location.search).toEqual({ type: 'prd' })
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/projects/p-1/transition', expect.anything())
  })

  it('marks the PRD purchased once it has been paid for', async () => {
    stubApi({ prd: { ...PRD, paidAt: '2026-03-01T00:00:00.000Z' } })
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Buy PRD Only/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'prd_purchased' }) }),
      ),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })
})

/**
 * Development starts by funding escrow. The page must route to the checkout
 * rather than transitioning the project for free.
 */
describe('proceeding to development', () => {
  it('routes to the escrow checkout instead of transitioning for free', async () => {
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Proceed to Development/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/checkout'))
    expect(router.state.location.search).toEqual({ type: 'escrow' })
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/projects/p-1/transition', expect.anything())
  })
})

describe('requesting a revision', () => {
  async function openRevision() {
    const user = userEvent.setup()
    const rendered = await render()
    await user.click(await screen.findByRole('button', { name: /Request Revision/ }))
    return { user, ...rendered }
  }

  it('sends the revision the owner described', async () => {
    const fetchMock = stubRevision()
    const { user } = await openRevision()

    await user.type(
      screen.getByPlaceholderText('Write your revision request...'),
      'Kurangi tim jadi 1 orang',
    )
    await user.click(screen.getByRole('button', { name: /Send Revision/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('/api/v1/projects/p-1/prd/revision')
    expect(init.body).toBe(JSON.stringify({ description: 'Kurangi tim jadi 1 orang' }))
    expect(toastMessages()).toContain('Revision request sent successfully')
  })

  it('carries the owner to checkout when the revision cap is reached', async () => {
    stubRevision({ status: 402 })
    const { user, router } = await openRevision()

    await user.type(screen.getByPlaceholderText('Write your revision request...'), 'Lagi')
    await user.click(screen.getByRole('button', { name: /Send Revision/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/checkout'))
    expect(router.state.location.search).toEqual({ type: 'prd' })
  })

  it('reports any other refusal in the owner language', async () => {
    stubRevision({ status: 409, code: 'PROJECT_VALIDATION_INVALID_STATUS' })
    const { user, router } = await openRevision()

    await user.type(screen.getByPlaceholderText('Write your revision request...'), 'Lagi')
    await user.click(screen.getByRole('button', { name: /Send Revision/ }))

    await waitFor(() => expect(toastMessages().length).toBeGreaterThan(0))
    expect(toastMessages()[0]).not.toBe('PROJECT_VALIDATION_INVALID_STATUS')
    expect(router.state.location.pathname).toBe('/projects/p-1/prd')
  })

  it('refuses to send an empty revision', async () => {
    await openRevision()

    expect(screen.getByRole('button', { name: /Send Revision/ }).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('closes the revision box without sending anything', async () => {
    const fetchMock = stubRevision()
    const { user } = await openRevision()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Write your revision request...')).toBeNull(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The dismiss control in the revision panel header is an icon-only button
   * with no aria-label and no text, so it has no accessible name and cannot be
   * reached by role - the same defect as on the BRD page. Located through the
   * DOM instead, which is the finding rather than a workaround.
   */
  it('closes from the unnamed dismiss control in the panel header', async () => {
    const { user } = await openRevision()
    const panel = (await screen.findByPlaceholderText('Write your revision request...'))
      .parentElement as HTMLElement
    const dismiss = within(panel).getAllByRole('button')[0]
    expect(dismiss.getAttribute('aria-label')).toBeNull()
    expect(dismiss.textContent).toBe('')

    await user.click(dismiss)

    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Write your revision request...')).toBeNull(),
    )
  })

  it('clears what was typed so a reopened box does not resend it', async () => {
    const { user } = await openRevision()
    await user.type(screen.getByPlaceholderText('Write your revision request...'), 'Draf lama')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(await screen.findByRole('button', { name: /Request Revision/ }))

    expect(
      (screen.getByPlaceholderText('Write your revision request...') as HTMLTextAreaElement).value,
    ).toBe('')
  })
})
