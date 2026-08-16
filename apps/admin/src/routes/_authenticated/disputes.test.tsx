// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRouteWithQuery } from '@/lib/testing/harness'
import { Route } from './disputes'

/**
 * Dispute resolution is a binding decision under CLAUDE.md's step 3: it moves
 * escrow to the talent, refunds it to the owner, or splits it, and it cannot
 * be appealed. It is the largest irreversible action in the console.
 *
 * These assert what the decision sends and what gates it: the written
 * reasoning is the only gate today, and each of the three outcomes has to
 * reach the endpoint as its own resolution type. The absence of a confirmation
 * step is reported separately as a product gap rather than asserted here.
 */

const OPEN_DISPUTE = {
  id: 'd-1',
  projectId: 'p-1',
  projectTitle: 'Toko Online Kopi',
  workPackageId: null,
  workPackageTitle: null,
  initiatedBy: 'u-owner',
  initiatedByName: 'Budi Santoso',
  initiatedByRole: 'owner',
  againstUserId: 'u-talent',
  againstUserName: 'Ani Lestari',
  againstUserRole: 'talent',
  reason: 'Deliverable tidak sesuai PRD',
  status: 'open' as const,
  amount: 12_000_000,
  resolutionType: null,
  resolvedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const DETAIL = {
  ...OPEN_DISPUTE,
  evidenceUrls: ['https://storage.example/bukti/tangkapan-layar.png'],
  resolution: null,
  resolvedBy: null,
  statusHistory: [],
}

const COUNTS = { open: 3, under_review: 1, mediation: 0, escalated: 0, resolved: 7 }

type Options = {
  rows?: unknown[]
  detail?: Record<string, unknown>
  /** Answer the detail path 200 with a null body, which `detail` cannot express. */
  detailMissing?: boolean
  listFails?: boolean
  detailFails?: boolean
  mutationFails?: boolean
  /**
   * Reject the PATCH with something that is not an Error.
   *
   * `mutationFails` answers a 409 carrying a message, so the client turns it
   * into an Error and the operator reads the server's reason. A transport that
   * throws a bare value -- an aborted fetch, a proxy returning a string -- has
   * no `.message`, and the handler's fallback is the only thing standing
   * between that and an alert reading "undefined".
   */
  mutationThrowsNonError?: boolean
}

function stubFetch(options: Options = {}) {
  const rows = options.rows ?? [OPEN_DISPUTE]
  const detail = options.detail ?? DETAIL
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      if (options.mutationThrowsNonError) throw 'socket hang up'
      if (options.mutationFails) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            success: false,
            error: { code: 'DISPUTE_INVALID_STATUS', message: 'Transisi tidak valid' },
          }),
        }
      }
      return { ok: true, status: 204, json: async () => null }
    }
    if (url.includes('status-counts')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: COUNTS }) }
    }
    // The detail path ends in the id; the list path carries a query string.
    if (/\/disputes\/[^/?]+$/.test(url)) {
      if (options.detailFails) {
        return { ok: false, status: 500, json: async () => ({ success: false }) }
      }
      if (options.detailMissing) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: null }) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: detail }) }
    }
    if (options.listFails) {
      return { ok: false, status: 500, json: async () => ({ success: false }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { items: rows, total: rows.length, page: 1, pageSize: 50 },
      }),
    }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

const renderPage = () => renderRouteWithQuery({ Route })

function patchCalls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
}

async function expandDispute(options: Options = {}) {
  const user = userEvent.setup()
  const spy = stubFetch(options)
  await renderPage()
  await user.click(await screen.findByRole('button', { name: /Toko Online Kopi/ }))
  return { user, spy }
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dispute list', () => {
  it('shows the disputed amount, the parties and the reason', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Toko Online Kopi')).toBeDefined()
    expect(screen.getByText('Rp 12 jt')).toBeDefined()
    expect(screen.getByText('Budi Santoso')).toBeDefined()
    expect(screen.getByText('Ani Lestari')).toBeDefined()
    expect(screen.getByText('Deliverable tidak sesuai PRD')).toBeDefined()
  })

  it('publishes the per-status counts an operator triages from', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('3')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
  })

  it('offers a retry rather than a blank page when the list fails', async () => {
    stubFetch({ listFails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat dispute')).toBeDefined()
    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeDefined()
  })

  it('says so when the filter matches no dispute', async () => {
    stubFetch({ rows: [] })
    await renderPage()

    expect(await screen.findByText('Tidak ada dispute untuk filter ini')).toBeDefined()
  })

  /** The count tiles double as filters, and pressing the active one clears it. */
  it('filters from a status tile and clears it on a second press', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await screen.findByText('Toko Online Kopi')

    const tile = screen.getAllByRole('button').find((b) => b.textContent?.includes('Mediation'))
    await user.click(tile as HTMLElement)
    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('status=mediation'))).toBe(true),
    )

    const before = spy.mock.calls.length
    await user.click(tile as HTMLElement)
    await waitFor(() =>
      expect(
        spy.mock.calls.slice(before).some(([u]) => !String(u).includes('status=mediation')),
      ).toBe(true),
    )
  })

  it('retries the list from the error state', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ listFails: true })
    await renderPage()
    await screen.findByText('Gagal memuat dispute')
    const before = spy.mock.calls.length

    await user.click(screen.getByRole('button', { name: /Coba lagi/ }))

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before))
  })

  it('narrows the list by status', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status' }), 'mediation')

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('status=mediation'))).toBe(true),
    )
  })
})

describe('dispute detail', () => {
  it('lists the evidence each side filed', async () => {
    await expandDispute()

    expect(await screen.findByText('tangkapan-layar.png')).toBeDefined()
  })

  it('says so when no evidence was attached', async () => {
    await expandDispute({ detail: { ...DETAIL, evidenceUrls: [] } })

    expect(await screen.findByText('Tidak ada bukti terlampir')).toBeDefined()
  })

  it('offers a retry when the detail alone fails', async () => {
    const { user, spy } = await expandDispute({ detailFails: true })

    expect(await screen.findByText('Gagal memuat detail dispute')).toBeDefined()
    const before = spy.mock.calls.length

    await user.click(screen.getByRole('button', { name: /Coba lagi/ }))

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before))
  })

  it('collapses again on a second press', async () => {
    const { user } = await expandDispute()
    await screen.findByRole('heading', { name: /Bukti/ })

    await user.click(screen.getByRole('button', { name: /Toko Online Kopi/ }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: /Bukti/ })).toBeNull())
  })
})

describe('dispute status transitions', () => {
  /** Escalation is only valid from mediation; the route offers one step at a time. */
  it.each([
    ['open', 'Mulai Review', 'under_review'],
    ['under_review', 'Mulai Mediasi', 'mediation'],
    ['mediation', 'Eskalasi', 'escalated'],
  ])('offers only the next step from %s', async (status, label, target) => {
    const row = { ...OPEN_DISPUTE, status: status as 'open' }
    const { user, spy } = await expandDispute({
      rows: [row],
      detail: { ...DETAIL, status },
    })

    await user.click(await screen.findByRole('button', { name: new RegExp(label) }))

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    const [url, init] = patchCalls(spy)[0]
    expect(url).toBe('/api/v1/disputes/d-1/status')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ status: target })
  })

  it('offers no transition once the dispute is resolved', async () => {
    await expandDispute({
      rows: [{ ...OPEN_DISPUTE, status: 'resolved' }],
      detail: { ...DETAIL, status: 'resolved', resolvedAt: '2026-06-10T00:00:00.000Z' },
    })

    expect(await screen.findByText('Dispute ini sudah diselesaikan.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Cairkan ke Talenta/ })).toBeNull()
    expect(screen.queryByText('Ubah Status')).toBeNull()
  })

  /** A rejected transition used to fail without a trace. */
  it('surfaces a rejected transition to the operator', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    const { user } = await expandDispute({ mutationFails: true })

    await user.click(await screen.findByRole('button', { name: /Mulai Review/ }))

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Transisi tidak valid'))
  })

  it('names the failure generically when the rejection carries no message', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    const { user } = await expandDispute({ mutationThrowsNonError: true })

    await user.click(await screen.findByRole('button', { name: /Mulai Review/ }))

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Transisi gagal'))
  })
})

describe('dispute resolution', () => {
  async function openEscalated(options: Options = {}) {
    return expandDispute({
      rows: [{ ...OPEN_DISPUTE, status: 'escalated' }],
      detail: { ...DETAIL, status: 'escalated' },
      ...options,
    })
  }

  /** The written reasoning is stored on the dispute record as the decision. */
  it('refuses to resolve without a reasoning', async () => {
    const { spy } = await openEscalated()

    for (const name of ['Cairkan ke Talenta', 'Kembalikan ke Pemilik Proyek', 'Bagi 50/50']) {
      expect(
        (await screen.findByRole<HTMLButtonElement>('button', { name: new RegExp(name) })).disabled,
        name,
      ).toBe(true)
    }
    expect(patchCalls(spy)).toHaveLength(0)
  })

  it('refuses on whitespace alone', async () => {
    const { user } = await openEscalated()

    await user.type(await screen.findByPlaceholderText('Masukkan alasan keputusan...'), '   ')

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Cairkan ke Talenta/ }).disabled,
    ).toBe(true)
  })

  it.each([
    ['Cairkan ke Talenta', 'funds_to_talent'],
    ['Kembalikan ke Pemilik Proyek', 'funds_to_owner'],
    ['Bagi 50/50', 'split'],
  ])('sends %s as %s with the reasoning', async (label, resolutionType) => {
    const { user, spy } = await openEscalated()

    await user.type(
      await screen.findByPlaceholderText('Masukkan alasan keputusan...'),
      'Bukti mendukung talenta',
    )
    await user.click(screen.getByRole('button', { name: new RegExp(label) }))

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    const [url, init] = patchCalls(spy)[0]
    expect(url).toBe('/api/v1/disputes/d-1/resolve')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      resolution: 'Bukti mendukung talenta',
      resolutionType,
    })
  })

  /**
   * Not asserted: today a single click on a binding, unappealable decision
   * reaches the endpoint with no confirmation in between, while suspension --
   * a smaller action -- does confirm. Reported as a product gap rather than
   * pinned, so adding the dialog does not turn a test red.
   */

  /** Resolution moves money before marking resolved; a failure must be visible. */
  it('tells the operator when the resolution failed so it can be retried', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    const { user } = await openEscalated({ mutationFails: true })

    await user.type(await screen.findByPlaceholderText('Masukkan alasan keputusan...'), 'Keputusan')
    await user.click(screen.getByRole('button', { name: /Bagi 50\/50/ }))

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Transisi tidak valid'))
  })

  /**
   * Same fallback as the transition, asserted separately because the two
   * handlers carry different copy and a shared helper would hide a swap.
   */
  it('still names the failure when the resolution rejects without a message', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    const { user } = await openEscalated({ mutationThrowsNonError: true })

    await user.type(await screen.findByPlaceholderText('Masukkan alasan keputusan...'), 'Keputusan')
    await user.click(screen.getByRole('button', { name: /Bagi 50\/50/ }))

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Penyelesaian gagal'))
  })

  it.each([
    ['funds_to_talent', 'Dana Dicairkan ke Talenta'],
    ['funds_to_owner', 'Dana Dikembalikan ke Pemilik Proyek'],
    ['split', 'Dana Dibagi 50/50'],
  ])('reports a settled %s outcome', async (resolutionType, expected) => {
    await expandDispute({
      rows: [{ ...OPEN_DISPUTE, status: 'resolved' }],
      detail: {
        ...DETAIL,
        status: 'resolved',
        resolutionType,
        resolution: 'Bukti seimbang',
        resolvedAt: '2026-06-10T00:00:00.000Z',
      },
    })

    expect(await screen.findByText(expected)).toBeDefined()
    expect(screen.getByText('Bukti seimbang')).toBeDefined()
  })
})

/**
 * The list header's own state.
 *
 * The filter defaults to an empty string internally and renders "all"; picking
 * a real status has to survive the round trip, because a filter that silently
 * resets sends an operator back through a queue they already triaged.
 */
describe('the status filter', () => {
  it('drops the parameter again when All Status is chosen', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await screen.findByText('Toko Online Kopi')

    const filter = screen.getByRole('combobox', { name: 'Status' })
    await user.selectOptions(filter, 'under_review')
    await waitFor(() => {
      expect(spy.mock.calls.some(([u]) => String(u).includes('status=under_review'))).toBe(true)
    })
    spy.mockClear()
    await user.selectOptions(filter, 'all')

    await waitFor(() => {
      const listCalls = spy.mock.calls.filter(([u]) => !String(u).includes('status-counts'))
      expect(listCalls.length).toBeGreaterThan(0)
      expect(listCalls.every(([u]) => !String(u).includes('status='))).toBe(true)
    })
  })
})

/** A dispute raised against one work package rather than the whole project. */
describe('a per-work-package dispute', () => {
  it('names the work package beside the project', async () => {
    stubFetch({
      rows: [{ ...OPEN_DISPUTE, workPackageId: 'wp-1', workPackageTitle: 'Backend API' }],
    })
    await renderPage()

    expect(await screen.findByText('Backend API')).toBeDefined()
  })
})

describe('the status timeline', () => {
  it('lists each transition the dispute went through', async () => {
    await expandDispute({
      detail: {
        ...DETAIL,
        statusHistory: [
          {
            fromStatus: 'open',
            toStatus: 'under_review',
            createdAt: '2026-06-02T00:00:00.000Z',
          },
          {
            fromStatus: 'under_review',
            toStatus: 'mediation',
            createdAt: '2026-06-04T00:00:00.000Z',
          },
        ],
      },
    })

    expect(await screen.findByText('Dispute Dibuat')).toBeDefined()
    const timeline = (await screen.findByText('Dispute Dibuat')).closest('div')?.parentElement
      ?.parentElement as HTMLElement
    expect(timeline.textContent).toContain('Open')
    expect(timeline.textContent).toContain('Mediation')
  })
})

/**
 * A detail the server answered with no body.
 *
 * Not loading and not an error, so neither of the two guarded arms applies.
 * The row has to stay expandable and the rest of the queue usable rather than
 * throwing on a null dispute.
 */
describe('an expanded dispute the server has no record of', () => {
  it('renders nothing in the panel and leaves the queue intact', async () => {
    const { spy } = await expandDispute({ detailMissing: true })

    await waitFor(() => {
      expect(spy.mock.calls.some(([u]) => /\/disputes\/d-1$/.test(String(u)))).toBe(true)
    })
    expect(screen.queryByRole('button', { name: /Mulai Review/ })).toBeNull()
    expect(screen.getByText('Deliverable tidak sesuai PRD')).toBeDefined()
  })
})

/**
 * The operator collapses the row before the PATCH lands.
 *
 * onSuccess re-reads the expanded dispute, and by then there may not be one.
 * Without the guard that invalidate runs against a null id.
 */
describe('a transition that lands after the row was collapsed', () => {
  it('refreshes the queue without re-reading a dispute nobody is looking at', async () => {
    let releasePatch: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      releasePatch = resolve
    })
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        await pending
        return { ok: true, status: 204, json: async () => null }
      }
      if (url.includes('status-counts')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: COUNTS }) }
      }
      if (/\/disputes\/[^/?]+$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: DETAIL }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { items: [OPEN_DISPUTE], total: 1, page: 1, pageSize: 50 },
        }),
      }
    })
    vi.stubGlobal('fetch', spy)

    const user = userEvent.setup()
    await renderPage()
    const row = await screen.findByRole('button', { name: /Toko Online Kopi/ })
    await user.click(row)

    await user.click(await screen.findByRole('button', { name: /Mulai Review/ }))
    // Collapse while the PATCH is still unsettled.
    await user.click(row)
    await waitFor(() => expect(screen.queryByText('Bukti')).toBeNull())

    releasePatch()

    await waitFor(() => {
      expect(
        spy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH'),
      ).toBe(true)
    })
    expect(screen.getByText('Deliverable tidak sesuai PRD')).toBeDefined()
  })
})

/** The same race on the resolve path, which also re-reads the expanded row. */
describe('a resolution that lands after the row was collapsed', () => {
  it('clears the note and refreshes the queue without re-reading the dispute', async () => {
    let releasePatch: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      releasePatch = resolve
    })
    const escalated = { ...OPEN_DISPUTE, status: 'escalated' as const }
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        await pending
        return { ok: true, status: 204, json: async () => null }
      }
      if (url.includes('status-counts')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: COUNTS }) }
      }
      if (/\/disputes\/[^/?]+$/.test(url)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { ...DETAIL, status: 'escalated' } }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { items: [escalated], total: 1, page: 1, pageSize: 50 },
        }),
      }
    })
    vi.stubGlobal('fetch', spy)

    const user = userEvent.setup()
    await renderPage()
    const row = await screen.findByRole('button', { name: /Toko Online Kopi/ })
    await user.click(row)

    await user.type(
      await screen.findByPlaceholderText('Masukkan alasan keputusan...'),
      'Bukti mendukung talenta',
    )
    await user.click(screen.getByRole('button', { name: /Cairkan ke Talenta/ }))
    await user.click(row)
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Masukkan alasan keputusan...')).toBeNull(),
    )

    releasePatch()

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    // Reopening shows an empty note, so the cleared state survived the race.
    await user.click(row)
    const note = await screen.findByPlaceholderText<HTMLTextAreaElement>(
      'Masukkan alasan keputusan...',
    )
    expect(note.value).toBe('')
  })
})
