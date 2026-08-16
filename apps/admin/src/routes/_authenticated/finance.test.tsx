// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRouteWithQuery } from '@/lib/testing/harness'
import { Route } from './finance'

/**
 * Every figure on this screen is one an operator acts on: platform revenue,
 * escrow still held against active projects, and the transaction ledger they
 * reconcile against the payment gateway. A formatting or aggregation error
 * here is a wrong decision about somebody's money.
 *
 * Compact Rupiah folds a miliar to juta rather than switching to an M suffix,
 * which is the difference between reading Rp 2.5 miliar and Rp 2.5 juta, so
 * the exact rendered string is worth pinning at the point of use as well as in
 * the formatter.
 */

const SUMMARY = {
  totalRevenue: 2_500_000_000,
  thisMonthRevenue: 12_000_000,
  lastMonthRevenue: 10_000_000,
  brdRevenue: 15_000_000,
  prdRevenue: 35_000_000,
  marginRevenue: 250_000_000,
  revisionFee: 4_000_000,
  placementFee: 9_000_000,
  escrowHeld: 88_000_000,
}

const ESCROW = [
  {
    projectId: 'p-1',
    projectTitle: 'Warung Kopi Digital',
    status: 'in_progress',
    totalEscrow: 40_000_000,
    released: 10_000_000,
    remaining: 30_000_000,
  },
]

const TRANSACTIONS = [
  {
    id: 'tx-1',
    projectId: 'p-1',
    projectTitle: 'Toko Online Kopi',
    talentId: 'tp-1',
    talentName: 'Ani Lestari',
    type: 'escrow_release' as const,
    amount: 7_000_000,
    status: 'completed' as const,
    paymentMethod: 'bank_transfer',
    paymentGatewayRef: 'MID-123',
    createdAt: '2026-07-24T00:00:00.000Z',
  },
  {
    id: 'tx-2',
    projectId: 'p-2',
    projectTitle: 'Aplikasi "Kasir" Warung',
    talentName: null,
    talentId: null,
    type: 'refund' as const,
    amount: 2_000_000,
    status: 'refunded' as const,
    paymentMethod: null,
    paymentGatewayRef: null,
    createdAt: '2026-07-25T00:00:00.000Z',
  },
]

type Options = {
  summary?: Record<string, number> | null
  escrow?: unknown[]
  transactions?: unknown[]
  summaryFails?: boolean
  escrowFails?: boolean
  txFails?: boolean
  hang?: boolean
}

function stubFetch(options: Options = {}) {
  const spy = vi.fn(async (url: string) => {
    if (options.hang) return new Promise(() => {}) as never
    if (url.includes('/escrow')) {
      if (options.escrowFails) return { ok: false, status: 500, json: async () => ({}) }
      return {
        ok: true,
        json: async () => ({ success: true, data: options.escrow ?? ESCROW }),
      }
    }
    if (url.includes('/transactions')) {
      if (options.txFails) return { ok: false, status: 500, json: async () => ({}) }
      const items = options.transactions ?? TRANSACTIONS
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { items, total: items.length, page: 1, pageSize: 50 },
        }),
      }
    }
    if (options.summaryFails) return { ok: false, status: 500, json: async () => ({}) }
    return {
      ok: true,
      json: async () => ({ success: true, data: options.summary ?? SUMMARY }),
    }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

const renderPage = () => renderRouteWithQuery({ Route })

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('revenue summary', () => {
  it('renders each headline figure as compact Rupiah', async () => {
    stubFetch()
    await renderPage()

    // A miliar keeps folding to juta; "Rp 2.500 jt" is not "Rp 2,5 M".
    expect(await screen.findByText('Rp 2.500 jt')).toBeDefined()
    expect(screen.getByText('Rp 12 jt')).toBeDefined()
    expect(screen.getByText('Rp 15 jt')).toBeDefined()
    expect(screen.getByText('Rp 35 jt')).toBeDefined()
    expect(screen.getByText('Rp 250 jt')).toBeDefined()
    expect(screen.getByText('Rp 88 jt')).toBeDefined()
  })

  it('computes the month-on-month change from the two months given', async () => {
    stubFetch()
    await renderPage()

    // 12jt against 10jt.
    expect(await screen.findByText('+20.0%')).toBeDefined()
  })

  it('reports a fall with its sign', async () => {
    stubFetch({ summary: { ...SUMMARY, thisMonthRevenue: 8_000_000 } })
    await renderPage()

    expect(await screen.findByText('-20.0%')).toBeDefined()
  })

  /** The first trading month has no prior figure; dividing by it would be Infinity. */
  it('hides the change entirely when there is no prior month', async () => {
    stubFetch({ summary: { ...SUMMARY, lastMonthRevenue: 0 }, escrow: [] })
    await renderPage()

    expect(await screen.findByText('Rp 12 jt')).toBeDefined()
    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('shows a placeholder rather than Rp 0 while the summary loads', async () => {
    stubFetch({ hang: true })
    await renderPage()

    expect(screen.getAllByText('...').length).toBeGreaterThan(0)
  })

  /**
   * A failed summary leaves the cards at zero rather than blank. Worth pinning
   * as the current behaviour: an operator reading Rp 0 total revenue has no
   * signal that the figure is missing rather than real.
   */
  it('falls back to zero when the summary request fails', async () => {
    stubFetch({ summaryFails: true })
    await renderPage()

    await waitFor(() => expect(screen.getAllByText('Rp 0').length).toBeGreaterThan(0))
  })
})

describe('escrow by project', () => {
  it('shows what is still held against what was released', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Warung Kopi Digital')).toBeDefined()
    expect(screen.getByText('Rp 30 jt')).toBeDefined()
    expect(screen.getByText(/Rp 40 jt/)).toBeDefined()
    expect(screen.getByText(/Rp 10 jt/)).toBeDefined()
    // 10jt of 40jt released.
    expect(screen.getByText('25%')).toBeDefined()
  })

  /** A project whose escrow was never funded must not divide by zero. */
  it('reports nothing released when the escrow total is zero', async () => {
    stubFetch({ escrow: [{ ...ESCROW[0], totalEscrow: 0, released: 0, remaining: 0 }] })
    await renderPage()

    expect(await screen.findByText('0%')).toBeDefined()
  })

  it('marks a disputed project apart from a healthy one', async () => {
    stubFetch({ escrow: [{ ...ESCROW[0], status: 'disputed' }] })
    await renderPage()

    expect((await screen.findByText('disputed')).className).toContain('text-error-500')
  })

  it('replaces underscores in the status for display', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('in progress')).toBeDefined()
  })

  it('says so when no project holds escrow', async () => {
    stubFetch({ escrow: [] })
    await renderPage()

    expect(await screen.findByText('No projects with held escrow')).toBeDefined()
  })

  it('reports a failed escrow query instead of an empty section', async () => {
    stubFetch({ escrowFails: true })
    await renderPage()

    expect(await screen.findByText(/Failed to load/)).toBeDefined()
  })
})

describe('transaction ledger', () => {
  it('labels each transaction type and renders its amount', async () => {
    stubFetch()
    await renderPage()

    // The type filter renders an <option> per type, so wait on a ledger-only value.
    expect(await screen.findByText('Rp 7 jt')).toBeDefined()
    expect(screen.getAllByText('Escrow Release').length).toBe(2)
    expect(screen.getAllByText('Refund').length).toBe(2)
  })

  /** Money leaving the platform has to read as negative, not as income. */
  it('signs a refund negative and colours it as an outflow', async () => {
    stubFetch()
    await renderPage()

    const refund = await screen.findByText('-Rp 2 jt')
    expect(refund.className).toContain('text-error-500')
  })

  it('leaves an inflow unsigned', async () => {
    stubFetch()
    await renderPage()

    expect((await screen.findByText('Rp 7 jt')).className).toContain('text-warning-500')
  })

  it('falls back to a dash where there is no talent or method', async () => {
    stubFetch()
    await renderPage()

    await screen.findByText('-Rp 2 jt')
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })

  it('shows an unrecognised type as its raw value rather than blank', async () => {
    stubFetch({ transactions: [{ ...TRANSACTIONS[0], type: 'chargeback', status: 'unknown' }] })
    await renderPage()

    expect(await screen.findByText('chargeback')).toBeDefined()
    expect(screen.getByText('unknown')).toBeDefined()
  })

  it('says so when nothing matches the filter', async () => {
    stubFetch({ transactions: [] })
    await renderPage()

    expect(await screen.findByText('Tidak ada transaksi ditemukan')).toBeDefined()
  })

  it('reports a failed ledger query in the table body', async () => {
    stubFetch({ txFails: true })
    await renderPage()

    expect(await screen.findByText(/Failed to load/)).toBeDefined()
  })

  it('narrows the ledger by transaction type', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.selectOptions(await screen.findByRole('combobox'), 'refund')

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('type=refund'))).toBe(true),
    )
  })

  it('searches the ledger once the term settles', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.type(await screen.findByPlaceholderText('Cari proyek...'), 'kopi')

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('search=kopi'))).toBe(true),
    )
  })
})

describe('CSV export', () => {
  function stubDownload() {
    const created: Blob[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob)
        return 'blob:mock'
      }),
      revokeObjectURL: vi.fn(),
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    return { created, click }
  }

  it('offers no export while the ledger is empty', async () => {
    stubFetch({ transactions: [] })
    await renderPage()

    await screen.findByText('Tidak ada transaksi ditemukan')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Export CSV/ }).disabled).toBe(
      true,
    )
  })

  it('exports a header row and one row per transaction', async () => {
    const user = userEvent.setup()
    stubFetch()
    const { created, click } = stubDownload()
    await renderPage()
    await screen.findByText('Rp 7 jt')

    await user.click(screen.getByRole('button', { name: /Export CSV/ }))

    expect(click).toHaveBeenCalled()
    const csv = await created[0].text()
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      '"id","projectTitle","talentName","type","amount","status","method","date"',
    )
    expect(lines[1]).toContain('"tx-1"')
    expect(lines[1]).toContain('"7000000"')
    click.mockRestore()
  })

  /**
   * A project title carrying a quote would otherwise close the field early and
   * shift every later column, so the accountant reconciles the wrong figures.
   */
  it('doubles embedded quotes so a title cannot break the columns', async () => {
    const user = userEvent.setup()
    stubFetch()
    const { created, click } = stubDownload()
    await renderPage()
    await screen.findByText('-Rp 2 jt')

    await user.click(screen.getByRole('button', { name: /Export CSV/ }))

    const csv = await created[0].text()
    expect(csv).toContain('"Aplikasi ""Kasir"" Warung"')
    click.mockRestore()
  })

  it('writes an empty field rather than the word null for a missing talent', async () => {
    const user = userEvent.setup()
    stubFetch()
    const { created, click } = stubDownload()
    await renderPage()
    await screen.findByText('-Rp 2 jt')

    await user.click(screen.getByRole('button', { name: /Export CSV/ }))

    const csv = await created[0].text()
    expect(csv).not.toContain('"null"')
    expect(csv.split('\n')[2]).toContain('"","refund"')
    click.mockRestore()
  })
})
