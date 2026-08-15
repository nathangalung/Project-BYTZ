// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as browseRoute from './browse-projects'

/**
 * The public project list, the page a visitor lands on before they have an
 * account.
 *
 * `preferences-and-experience.test.ts` reads this file as text; nothing mounted
 * it. That left all four of its states unexecuted, including the one that
 * matters most: this page swallows every fetch failure and renders the empty
 * state, so a visitor cannot tell "no projects yet" from "the API is down".
 */

vi.setConfig({ testTimeout: 30_000 })

const fetchMock = vi.fn()

type ProjectRow = Record<string, unknown>

const PROJECT: ProjectRow = {
  id: 'p-1',
  title: 'Toko Online Kopi',
  description: 'Marketplace kopi lokal',
  category: 'web_app',
  status: 'matching',
  budgetMin: 5_000_000,
  budgetMax: 10_000_000,
  estimatedTimelineDays: 45,
  teamSize: 3,
  preferences: { requiredSkills: ['React', 'Node.js'] },
}

function stubList(items: ProjectRow[], ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    json: async () => ({ success: true, data: { items, total: items.length } }),
  })
}

function requestedUrls() {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

const render = () => renderRoute(browseRoute, { path: '/browse-projects' })

beforeEach(() => {
  fetchMock.mockReset()
  stubList([])
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('while the list is loading', () => {
  it('shows placeholders rather than an empty page', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6)
    expect(screen.queryByText('No projects available yet')).toBeNull()
  })

  it('still names the page and its purpose', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))

    await render()

    expect(screen.getByRole('heading', { level: 1, name: 'Browse Projects' })).toBeDefined()
    expect(screen.getByText('Discover projects in progress or looking for talent')).toBeDefined()
  })
})

describe('when there is nothing to show', () => {
  it('says so once the request settles', async () => {
    stubList([])

    await render()

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  /**
   * The source catches every failure and returns an empty page, so a visitor
   * reads a server error as "no projects". Recorded as a defect in the report;
   * pinned here so the behaviour cannot change unnoticed.
   */
  it('reports a server error the same way it reports an empty list', async () => {
    stubList([PROJECT], false)

    await render()

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('does the same when the network is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    await render()

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('does the same when the envelope carries no data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await render()

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('does the same when the page comes back without an items array', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) })

    await render()

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })
})

describe('a project card', () => {
  it('carries the title, summary, budget, timeline and team size', async () => {
    stubList([PROJECT])

    await render()

    const card = (await screen.findByRole('link', { name: /Toko Online Kopi/ })) as HTMLElement
    expect(within(card).getByText('Marketplace kopi lokal')).toBeDefined()
    expect(within(card).getByText(/45 days/)).toBeDefined()
    expect(within(card).getByText('3')).toBeDefined()
    expect(within(card).getByText(/Rp 5.000.000\s*-\s*Rp 10.000.000/)).toBeDefined()
  })

  it('links through to that project', async () => {
    stubList([PROJECT])

    await render()

    const card = await screen.findByRole('link', { name: /Toko Online Kopi/ })
    expect(card.getAttribute('href')).toBe('/project-detail/p-1')
  })

  it('translates the status and flags a project still looking for talent', async () => {
    stubList([PROJECT])

    await render()

    const card = (await screen.findByRole('link', { name: /Toko Online Kopi/ })) as HTMLElement
    expect(within(card).getByText('Matching')).toBeDefined()
    expect(within(card).getByText(/Looking for Talent/)).toBeDefined()
  })

  it('drops the talent flag once work has started', async () => {
    stubList([{ ...PROJECT, status: 'in_progress' }])

    await render()

    const card = (await screen.findByRole('link', { name: /Toko Online Kopi/ })) as HTMLElement
    expect(within(card).getByText('Active')).toBeDefined()
    expect(within(card).queryByText(/Looking for Talent/)).toBeNull()
  })

  it('falls back to the raw status when there is no translation for it', async () => {
    stubList([{ ...PROJECT, status: 'weird_state' }])

    await render()

    expect(await screen.findByText('weird_state')).toBeDefined()
  })

  it('shows the first three skills and counts the rest', async () => {
    stubList([
      { ...PROJECT, preferences: { requiredSkills: ['React', 'Node.js', 'Figma', 'Go', 'SQL'] } },
    ])

    await render()

    expect(await screen.findByText('React')).toBeDefined()
    expect(screen.getByText('Figma')).toBeDefined()
    expect(screen.queryByText('SQL')).toBeNull()
    expect(screen.getByText('+2')).toBeDefined()
  })

  it('copes with a project carrying no status at all', async () => {
    stubList([{ ...PROJECT, status: undefined }])

    await render()

    const card = (await screen.findByRole('link', { name: /Toko Online Kopi/ })) as HTMLElement
    expect(within(card).queryByText(/Looking for Talent/)).toBeNull()
    expect(card.textContent).toContain('Toko Online Kopi')
  })

  it('copes with a project carrying no category, skills or team size', async () => {
    stubList([
      { id: 'p-2', title: 'Bare', description: '', status: 'review', estimatedTimelineDays: 10 },
    ])

    const card = (await render()).container

    expect(await screen.findByText('Bare')).toBeDefined()
    expect(within(card).getByText('1')).toBeDefined()
  })

  it('spells the category out without its underscores', async () => {
    stubList([{ ...PROJECT, category: 'ui_ux_design' }])

    await render()

    expect(await screen.findByText('ui ux design')).toBeDefined()
  })
})

describe('the category filter', () => {
  it('starts on All with nothing pinned to the query', async () => {
    await render()

    await waitFor(() => expect(requestedUrls()).toHaveLength(1))
    expect(requestedUrls()[0]).toContain('page=1&pageSize=12')
    expect(requestedUrls()[0]).not.toContain('category=')
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeDefined()
  })

  it('asks the API again for the chosen category', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'Mobile App' }))

    await waitFor(() => expect(requestedUrls().at(-1)).toContain('category=mobile_app'))
    expect(screen.getByRole('button', { name: 'Mobile App', pressed: true })).toBeDefined()
    expect(screen.getByRole('button', { name: 'All', pressed: false })).toBeDefined()
  })

  it('offers every category the platform scopes', async () => {
    await render()

    const nav = screen.getByRole('navigation', { name: 'Filter by category' })
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All', 'Web App', 'Mobile App', 'UI/UX Design', 'Data/AI', 'Other Digital'])
  })
})

/**
 * The status control is a bare <select> with no label and no aria-label, so it
 * can only be reached by role. Recorded in the report as an accessibility
 * defect.
 */
describe('the status filter', () => {
  it('narrows the list to one status without asking the API to do it', async () => {
    const user = userEvent.setup()
    stubList([PROJECT, { ...PROJECT, id: 'p-2', title: 'Aplikasi Absensi', status: 'completed' }])
    await render()
    expect(await screen.findByText('Aplikasi Absensi')).toBeDefined()

    await user.selectOptions(screen.getByRole('combobox'), 'completed')

    await waitFor(() => expect(screen.queryByText('Toko Online Kopi')).toBeNull())
    expect(screen.getByText('Aplikasi Absensi')).toBeDefined()
    expect(requestedUrls().every((u) => !u.includes('status='))).toBe(true)
  })

  it('shows everything again when the filter is cleared', async () => {
    const user = userEvent.setup()
    stubList([PROJECT, { ...PROJECT, id: 'p-2', title: 'Aplikasi Absensi', status: 'completed' }])
    await render()

    await user.selectOptions(screen.getByRole('combobox'), 'completed')
    await waitFor(() => expect(screen.queryByText('Toko Online Kopi')).toBeNull())

    await user.selectOptions(screen.getByRole('combobox'), '')

    expect(await screen.findByText('Toko Online Kopi')).toBeDefined()
    expect(screen.getByText('Aplikasi Absensi')).toBeDefined()
  })

  it('empties the page when no project holds the chosen status', async () => {
    const user = userEvent.setup()
    stubList([PROJECT])
    await render()

    await user.selectOptions(screen.getByRole('combobox'), 'review')

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('offers only the statuses a visitor is allowed to see', async () => {
    await render()

    const options = within(screen.getByRole('combobox')).getAllByRole('option')
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      '',
      'matching',
      'team_forming',
      'matched',
      'in_progress',
      'review',
      'completed',
    ])
  })
})
