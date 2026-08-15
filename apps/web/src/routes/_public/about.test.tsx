// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as aboutRoute from './about'

/**
 * The public explainer page.
 *
 * Nothing mounted it before, so its whole body sat outside the coverage
 * denominator. What it decides is whether the platform numbers a visitor reads
 * are real: the section is meant to stay hidden rather than show zeros when
 * the stats call fails, and only a render can prove that.
 */

vi.setConfig({ testTimeout: 30_000 })

const fetchMock = vi.fn()

function stubStats(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body })
}

beforeEach(() => {
  fetchMock.mockReset()
  stubStats({ success: true, data: { total: 0, completed: 0, active: 0 } })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const render = () => renderRoute(aboutRoute, { path: '/about' })

describe('the page body', () => {
  it('names the platform and what it does', async () => {
    await render()

    expect(screen.getByRole('heading', { level: 1, name: 'About KerjaCUS!' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'What We Do' })).toBeDefined()
  })

  it('lists the three things the platform does for a visitor', async () => {
    await render()

    for (const title of ['AI-Powered Planning', 'Talent Matching', 'Escrow and Milestones']) {
      expect(screen.getByRole('heading', { name: title })).toBeDefined()
    }
  })

  it('explains the technology behind each of the four capabilities', async () => {
    await render()

    expect(screen.getByRole('heading', { name: 'Technology Behind the Platform' })).toBeDefined()
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'BRD/PRD Generator',
      'CV Parser',
      'Smart Matching',
      'Escrow Protection',
    ])
  })

  it('closes with the cross-industry note', async () => {
    await render()

    expect(screen.getByText(/supports cross-industry projects/i)).toBeDefined()
  })
})

/**
 * The four-state contract for the one number-bearing section. "Real numbers
 * only" is the comment in the source; a hidden section is the honest failure.
 */
describe('the platform numbers', () => {
  it('withholds the section while the request is still open', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))

    await render()

    expect(screen.queryByText('Total Projects')).toBeNull()
  })

  it('shows the counts the API returned', async () => {
    stubStats({ success: true, data: { total: 42, completed: 30, active: 12 } })

    await render()

    expect(await screen.findByText('42')).toBeDefined()
    expect(screen.getByText('30')).toBeDefined()
    expect(screen.getByText('12')).toBeDefined()
    expect(screen.getByText('Total Projects')).toBeDefined()
  })

  it('states the matching guarantee alongside the counts', async () => {
    stubStats({ success: true, data: { total: 1, completed: 1, active: 1 } })

    await render()

    expect(await screen.findByText('<72j')).toBeDefined()
    expect(screen.getByText('Matching Time')).toBeDefined()
  })

  it('withholds the section rather than showing zeros when the API errors', async () => {
    stubStats({ success: true, data: { total: 42, completed: 30, active: 12 } }, false)

    await render()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('42')).toBeNull()
    expect(screen.queryByText('Total Projects')).toBeNull()
  })

  it('withholds the section when the envelope reports failure', async () => {
    stubStats({ success: false, data: null })

    await render()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('Total Projects')).toBeNull()
  })

  it('survives a network failure without breaking the page', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    await render()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1, name: 'About KerjaCUS!' })).toBeDefined()
    expect(screen.queryByText('Total Projects')).toBeNull()
  })

  it('asks the stats endpoint with an abort signal it can cancel', async () => {
    const { unmount } = await render()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/projects/stats')
    expect(init.signal?.aborted).toBe(false)

    unmount()

    expect(init.signal?.aborted).toBe(true)
  })
})
