// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as landingRoute from './index'

/**
 * The landing page, the only page most visitors ever see.
 *
 * `landing-honesty.test.ts` reads this file as text to check it quotes no
 * invented numbers; nothing mounted it, so the three-state stats block and the
 * testimonial list were never executed. The honesty rule is enforced at
 * runtime here: a failed stats call must render an em dash, never a zero and
 * never a made-up figure.
 */

vi.setConfig({ testTimeout: 30_000 })

const fetchMock = vi.fn()

const STATS = { total: 128, completed: 96, active: 24 }

const REVIEW = {
  id: 'r-1',
  rating: 5,
  comment: 'Prosesnya rapi dari awal sampai selesai',
  type: 'owner_to_talent',
  createdAt: '2026-02-10T00:00:00.000Z',
}

type Stub = { reviews?: unknown; stats?: unknown; statsOk?: boolean }

function stubApi({ reviews = { success: true, data: [] }, stats, statsOk = true }: Stub = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes('/reviews/public')) {
      return Promise.resolve({ ok: true, json: async () => reviews })
    }
    return Promise.resolve({
      ok: statsOk,
      status: statsOk ? 200 : 500,
      json: async () => stats ?? { success: true, data: STATS },
    })
  })
}

const render = () =>
  renderRoute(landingRoute, {
    path: '/',
    destinations: ['/request-project', '/browse-projects', '/about', '/login', '/register'],
  })

beforeEach(() => {
  fetchMock.mockReset()
  stubApi()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the hero', () => {
  it('leads with the platform promise and its badge', async () => {
    await render()

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Manage Your Projects')
    expect(screen.getByText('AI-Powered Marketplace')).toBeDefined()
  })

  it('offers both entry points side by side', async () => {
    await render()

    expect(
      screen.getAllByRole('link', { name: /Start Project|Submit Project/ })[0].getAttribute('href'),
    ).toBe('/request-project')
    expect(screen.getAllByRole('link', { name: /Browse Projects/ })[0].getAttribute('href')).toBe(
      '/browse-projects',
    )
  })

  it('declares the page language for a screen reader', async () => {
    const { container } = await render()

    expect(container.querySelector('[lang="id"]')).not.toBeNull()
  })

  it('names the three audiences the flow serves', async () => {
    await render()

    expect(screen.getByRole('heading', { name: 'For Project Owners' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'For Talent' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Shared Process' })).toBeDefined()
  })
})

/**
 * Three terminal states, and the failure one is load-bearing: this page is
 * marketing, so a zero where a real count belongs reads as a claim.
 */
describe('the platform counters', () => {
  it('shows placeholders while the counts are in flight', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('—')).toBeNull()
  })

  it('shows the real counts once they arrive', async () => {
    await render()

    expect(await screen.findByText('96+')).toBeDefined()
    expect(screen.getByText('24')).toBeDefined()
    expect(screen.getByText('128+')).toBeDefined()
  })

  it('states the matching guarantee, which needs no API', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))

    await render()

    expect(screen.getByText('72 Hours')).toBeDefined()
  })

  it('shows a dash rather than a zero when the stats call fails', async () => {
    stubApi({ statsOk: false })

    await render()

    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(3))
    expect(screen.queryByText('0+')).toBeNull()
  })

  it('shows a dash when the envelope reports failure', async () => {
    stubApi({ stats: { success: false, data: null } })

    await render()

    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(3))
  })

  it('shows a dash when the network is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    await render()

    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(3))
  })

  /**
   * An abort is not a failure. If it flipped the state the page would flash a
   * dash on any navigation that happens to race the request.
   */
  it('keeps the placeholders when the request is aborted rather than failing', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/reviews/public')
        ? Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) })
        : Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
    )

    const { container } = await render()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('—')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(3)
  })

  /** An abort on unmount is not a failure and must not flip the state. */
  it('cancels both requests when the visitor leaves', async () => {
    const { unmount } = await render()

    const signals = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).signal)
    expect(signals).toHaveLength(2)
    expect(signals.every((s) => s?.aborted === false)).toBe(true)

    unmount()

    expect(signals.every((s) => s?.aborted === true)).toBe(true)
  })
})

describe('the testimonials', () => {
  it('shows nothing at all when there are no public reviews', async () => {
    await render()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Prosesnya rapi/)).toBeNull()
  })

  it('shows a review with its rating and date', async () => {
    stubApi({ reviews: { success: true, data: [REVIEW] } })

    const { container } = await render()

    expect(await screen.findByText('Prosesnya rapi dari awal sampai selesai')).toBeDefined()
    const card = screen.getByText('Prosesnya rapi dari awal sampai selesai')
      .parentElement as HTMLElement
    expect(card.querySelectorAll('.fill-accent-cream-600')).toHaveLength(5)
    expect(container.textContent).toContain('10/2/2026')
  })

  it('fills only as many stars as the rating', async () => {
    stubApi({ reviews: { success: true, data: [{ ...REVIEW, rating: 3 }] } })

    await render()

    const card = (await screen.findByText('Prosesnya rapi dari awal sampai selesai'))
      .parentElement as HTMLElement
    expect(card.querySelectorAll('.fill-accent-cream-600')).toHaveLength(3)
  })

  it('substitutes a phrase for a rating left without a comment', async () => {
    stubApi({ reviews: { success: true, data: [{ ...REVIEW, comment: null }] } })

    await render()

    expect(await screen.findByText('Great experience!')).toBeDefined()
  })

  it('shows at most three, however many came back', async () => {
    stubApi({
      reviews: {
        success: true,
        data: [1, 2, 3, 4, 5].map((n) => ({ ...REVIEW, id: `r-${n}`, comment: `Review ${n}` })),
      },
    })

    await render()

    expect(await screen.findByText('Review 1')).toBeDefined()
    expect(screen.getByText('Review 3')).toBeDefined()
    expect(screen.queryByText('Review 4')).toBeNull()
  })

  it('ignores a reviews payload that is not a list', async () => {
    stubApi({ reviews: { success: true, data: 'nope' } })

    await render()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Review/)).toBeNull()
  })

  it('survives a reviews request that fails outright', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/reviews/public')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, json: async () => ({ success: true, data: STATS }) }),
    )

    await render()

    expect(await screen.findByText('96+')).toBeDefined()
  })
})

describe('the closing call to action', () => {
  it('offers a way in for both sides', async () => {
    await render()

    const cta = screen.getByRole('heading', { name: 'Ready to Start Your Project?' })
      .parentElement as HTMLElement
    expect(
      within(cta).getByRole('link', { name: 'Submit a Project Now' }).getAttribute('href'),
    ).toBe('/request-project')
    expect(within(cta).getByRole('link', { name: 'Register as Talent' }).getAttribute('href')).toBe(
      '/register',
    )
  })

  it('wraps the page in the public header and footer', async () => {
    const { container } = await render()

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeDefined()
    expect(container.querySelector('footer')).not.toBeNull()
    expect(container.querySelector('#main-content')).not.toBeNull()
  })
})
