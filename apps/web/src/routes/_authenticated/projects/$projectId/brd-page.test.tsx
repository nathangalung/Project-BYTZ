// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useToastStore } from '@/stores/toast'
import * as brdRoute from './brd'

/**
 * The document the owner pays for, and the fork where they decide whether to
 * stop at the BRD, continue to a PRD, or fund development.
 *
 * Nothing had executed this file - it reported zero statements, so it was
 * outside the coverage denominator rather than counted as uncovered. Two of
 * the branches here decide whether the owner is sent to a checkout, and the
 * paywall decides whether an unpaid document can be downloaded clean.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = { id: 'p-1', title: 'Toko Online Batik', status: 'brd_generated' }

const BRD = {
  id: 'b-1',
  status: 'review',
  version: 2,
  paidAt: null as string | null,
  content: {
    executive_summary: 'Marketplace batik untuk UMKM Jawa Tengah',
    business_objectives: ['Menaikkan penjualan 30%'],
    scope: 'Web app dengan checkout QRIS',
    estimated_price_min: 8_000_000,
    estimated_price_max: 12_000_000,
    estimated_timeline_days: 60,
    language: 'id',
  },
}

function stubApi(brd: unknown = BRD, project: unknown = PROJECT) {
  apiFetch.mockImplementation(async (url: string) => {
    const path = String(url)
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

function render() {
  return renderRoute(brdRoute, {
    path: '/projects/$projectId/brd',
    entry: '/projects/p-1/brd',
    destinations: [
      '/projects',
      '/projects/$projectId',
      '/projects/$projectId/scoping',
      '/projects/$projectId/prd',
      '/projects/$projectId/checkout',
    ],
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
  vi.stubGlobal('open', vi.fn())
})

describe('before the document exists', () => {
  it('says it is loading rather than showing an empty document', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    await render()

    expect(screen.getByText('Loading BRD document...')).toBeDefined()
  })

  it('sends the owner back to scoping when no BRD has been generated', async () => {
    stubApi(null)

    await render()

    expect(await screen.findByRole('heading', { name: 'BRD not created yet' })).toBeDefined()
    expect(screen.getByRole('link', { name: /Go to Scoping/ }).getAttribute('href')).toBe(
      '/projects/p-1/scoping',
    )
  })
})

describe('reading the document', () => {
  it('shows the document, its version and the project it belongs to', async () => {
    await render()

    expect(
      await screen.findByRole('heading', { name: 'Business Requirement Document' }),
    ).toBeDefined()
    expect(screen.getByText('Toko Online Batik')).toBeDefined()
    expect(screen.getByText(/Version\s*2/)).toBeDefined()
  })

  /**
   * The generator emits snake_case; the shared normaliser is what keeps the
   * preview and the PDF from disagreeing about what a BRD contains.
   */
  it('renders what the generator wrote in snake_case', async () => {
    const user = userEvent.setup()
    await render()

    expect(await screen.findByText(/Marketplace batik untuk UMKM/)).toBeDefined()

    // Only the summary and the functional requirements open by default.
    await user.click(screen.getByRole('button', { name: /Business Objectives/ }))

    expect(await screen.findByText(/Menaikkan penjualan 30%/)).toBeDefined()
  })

  /**
   * Unpaid copies carry a watermark; that is what payment removes. It is a
   * repeating inline-SVG background rather than text, and aria-hidden, so it
   * is asserted through the style it sets.
   */
  function watermark(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).find((el) =>
      el.style.backgroundImage.includes('PREVIEW'),
    )
  }

  it('watermarks the preview until the BRD is paid for', async () => {
    const { container } = await render()

    await screen.findByRole('heading', { name: 'Business Requirement Document' })
    expect(watermark(container)).toBeDefined()
  })

  it('drops the watermark once the BRD is paid for', async () => {
    stubApi({ ...BRD, paidAt: '2026-03-01T00:00:00.000Z' })

    const { container } = await render()

    await screen.findByRole('heading', { name: 'Business Requirement Document' })
    expect(watermark(container)).toBeUndefined()
  })

  /**
   * status_approved and status_paid are absent from both locales of the
   * `project` namespace, so i18next prints the key. The paid badge is what
   * tells an owner their payment landed, and it currently reads as a raw
   * identifier. Recorded as the current behaviour; it is a finding.
   */
  it('prints the raw key for a paid BRD because the locale entry is missing', async () => {
    stubApi({ ...BRD, status: 'paid', paidAt: '2026-03-01T00:00:00.000Z' })

    await render()

    expect(await screen.findByText('status_paid')).toBeDefined()
  })

  it('names the statuses the locale does carry', async () => {
    await render()

    expect(await screen.findByText('Review')).toBeDefined()
  })

  it('falls back to the draft badge for a status it does not know', async () => {
    stubApi({ ...BRD, status: 'archived' })

    await render()

    expect(await screen.findByText('Draft')).toBeDefined()
  })
})

/** Downloading a clean copy is what the owner is paying for. */
describe('the paywall on downloading', () => {
  it('offers only the unlock route while the BRD is unpaid', async () => {
    await render()

    const unlock = await screen.findByRole('link', { name: /Unlock Full BRD/ })
    expect(unlock.getAttribute('href')).toBe('/projects/p-1/checkout?type=brd')
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull()
  })

  it('offers the download once the BRD is paid for', async () => {
    stubApi({ ...BRD, paidAt: '2026-03-01T00:00:00.000Z' })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Download PDF/ }))

    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/p-1/brd/pdf'),
      '_blank',
    )
    expect(screen.queryByRole('link', { name: /Unlock Full BRD/ })).toBeNull()
  })
})

describe('requesting a revision', () => {
  async function openRevision() {
    const user = userEvent.setup()
    const rendered = await render()
    await user.click(await screen.findByRole('button', { name: /Request Revision/ }))
    return { user, ...rendered }
  }

  it('stays reachable before payment so the free revisions are usable', async () => {
    await render()

    expect(await screen.findByRole('button', { name: /Request Revision/ })).toBeDefined()
  })

  it('refuses to send an empty revision', async () => {
    await openRevision()

    expect(screen.getByRole('button', { name: /Send Revision/ }).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('sends the revision the owner described', async () => {
    const fetchMock = stubRevision()
    const { user } = await openRevision()

    await user.type(
      screen.getByPlaceholderText('Write your revision request...'),
      'Tambahkan integrasi QRIS',
    )
    await user.click(screen.getByRole('button', { name: /Send Revision/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('/api/v1/projects/p-1/brd/revision')
    // The service reads `description`; sending `content` silently revises nothing.
    expect(init.body).toBe(JSON.stringify({ description: 'Tambahkan integrasi QRIS' }))
    expect(toastMessages()).toContain('Revision request sent successfully')
  })

  /**
   * At the revision cap the service answers 402. A toast would be a dead end,
   * so the owner is carried to the checkout that buys more rounds.
   */
  it('carries the owner to checkout when the revision cap is reached', async () => {
    stubRevision({ status: 402 })
    const { user, router } = await openRevision()

    await user.type(screen.getByPlaceholderText('Write your revision request...'), 'Lagi')
    await user.click(screen.getByRole('button', { name: /Send Revision/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/checkout'))
    expect(router.state.location.search).toEqual({ type: 'brd' })
  })

  it('reports any other refusal in the owner language', async () => {
    stubRevision({ status: 409, code: 'PROJECT_VALIDATION_INVALID_STATUS' })
    const { user, router } = await openRevision()

    await user.type(screen.getByPlaceholderText('Write your revision request...'), 'Lagi')
    await user.click(screen.getByRole('button', { name: /Send Revision/ }))

    await waitFor(() => expect(toastMessages().length).toBeGreaterThan(0))
    expect(toastMessages()[0]).not.toBe('PROJECT_VALIDATION_INVALID_STATUS')
    expect(router.state.location.pathname).toBe('/projects/p-1/brd')
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
   * reached by role. Located through the DOM instead, which is the defect
   * rather than a workaround: a screen reader user has only the Cancel button.
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

/**
 * The three exits from the BRD. Buying it only is a paid transition; the two
 * that continue generate a PRD instead.
 */
describe('deciding what happens after the BRD', () => {
  it('sends an unpaid owner to checkout rather than marking the BRD purchased', async () => {
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Buy BRD Only/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/checkout'))
    expect(router.state.location.search).toEqual({ type: 'brd' })
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/projects/p-1/transition', expect.anything())
  })

  it('marks the BRD purchased once it has been paid for', async () => {
    stubApi({ ...BRD, paidAt: '2026-03-01T00:00:00.000Z' })
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Buy BRD Only/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'brd_purchased' }) }),
      ),
    )
    expect(toastMessages()).toContain('BRD purchased successfully')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('reports a refused purchase', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/transition')) throw new Error('nope')
      if (path.endsWith('/brd')) {
        return { success: true, data: { ...BRD, paidAt: '2026-03-01T00:00:00.000Z' } }
      }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Buy BRD Only/ }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to purchase BRD'))
  })

  it('generates the PRD and opens it', async () => {
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Continue to PRD/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/generate-prd',
        expect.objectContaining({ body: JSON.stringify({ language: 'id' }) }),
      ),
    )
    expect(toastMessages()).toContain('PRD generation started')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/prd'))
  })

  /** The PRD inherits the language the owner picked for the BRD. */
  it('generates the PRD in English when the BRD was written in English', async () => {
    stubApi({ ...BRD, content: { ...BRD.content, language: 'en' } })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /Start Development/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/generate-prd',
        expect.objectContaining({ body: JSON.stringify({ language: 'en' }) }),
      ),
    )
  })

  /**
   * handleContinuePrd and handleContinueDevelop are byte-identical, so both
   * arms need exercising to know neither has drifted.
   */
  it('reports a failed generation from the develop option too', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/generate-prd')) throw new Error('quota')
      if (path.endsWith('/brd')) return { success: true, data: BRD }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Start Development/ }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to generate PRD'))
    expect(router.state.location.pathname).toBe('/projects/p-1/brd')
  })

  it('reports a failed PRD generation rather than navigating away', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/generate-prd')) throw new Error('quota')
      if (path.endsWith('/brd')) return { success: true, data: BRD }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(await screen.findByRole('button', { name: /Continue to PRD/ }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to generate PRD'))
    expect(router.state.location.pathname).toBe('/projects/p-1/brd')
  })
})
