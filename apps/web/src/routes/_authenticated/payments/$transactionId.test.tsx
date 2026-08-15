// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as transactionRoute from './$transactionId'

/**
 * The receipt for one transaction, and the only screen in the app that shows
 * the double-entry legs behind a payment.
 *
 * What has to be right here is the money: the amount, which side of the ledger
 * each leg falls on, and that a debit is never printed in the credit column.
 * The rest of the page is layout. The invoice download is the other one worth
 * pinning, because the URL it opens carries the project and milestone ids and
 * a wrong pair hands somebody another project's invoice.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

type Txn = {
  id: string
  projectId: string
  projectTitle: string
  milestoneId: string | null
  type: string
  amount: number
  status: string
  paymentMethod: string | null
  paymentGatewayRef: string | null
  idempotencyKey: string
  createdAt: string
  events: Array<{
    id: string
    eventType: string
    previousStatus: string | null
    newStatus: string
    createdAt: string
  }>
  ledgerEntries: Array<{
    id: string
    entryType: 'debit' | 'credit'
    amount: number
    description: string | null
  }>
}

const TXN: Txn = {
  id: 'tx-1',
  projectId: 'p-1',
  projectTitle: 'Marketplace UMKM Bandung',
  milestoneId: 'm-3',
  type: 'escrow_release',
  amount: 10_000_000,
  status: 'completed',
  paymentMethod: 'bank_transfer',
  paymentGatewayRef: 'MID-88213',
  idempotencyKey: 'idem-abc',
  createdAt: '2026-08-01T04:30:00.000Z',
  events: [
    {
      id: 'ev-1',
      eventType: 'escrow_created',
      previousStatus: null,
      newStatus: 'pending',
      createdAt: '2026-08-01T04:30:00.000Z',
    },
    {
      id: 'ev-2',
      eventType: 'funds_released',
      previousStatus: 'pending',
      newStatus: 'completed',
      createdAt: '2026-08-02T04:30:00.000Z',
    },
  ],
  ledgerEntries: [
    { id: 'le-1', entryType: 'credit', amount: 10_000_000, description: 'Escrow release' },
    { id: 'le-2', entryType: 'debit', amount: 7_150_000, description: 'Talent payout' },
    { id: 'le-3', entryType: 'debit', amount: 2_850_000, description: null },
  ],
}

/** A promise that never settles, so the view stays in its loading state. */
const NEVER = () => new Promise(() => {})

function stub(txn: Txn | 'loading' | 'error') {
  apiFetch.mockImplementation(() => {
    if (txn === 'loading') return NEVER()
    if (txn === 'error') return Promise.reject(new Error('gone'))
    return Promise.resolve({ success: true, data: txn })
  })
}

function render() {
  return renderRoute(transactionRoute, {
    path: '/payments/$transactionId',
    entry: '/payments/tx-1',
    destinations: ['/payments'],
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  stub(TXN)
})

/**
 * Read a labelled field as the pair a reader sees.
 *
 * Queried by structure rather than by text because the page prints the same
 * amount in three places - the total, the escrow leg and the timeline - and a
 * bare text lookup for "Rp 10.000.000" is ambiguous. Every field on this
 * receipt is a label element followed immediately by its value.
 */
function fieldValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? ''
}

/** Loading and not-found must not look like each other on a money page. */
describe('the four states of the receipt', () => {
  it('withholds the not-found message while the request is in flight', async () => {
    stub('loading')

    await render()

    expect(screen.queryByText('Invoice not found')).toBeNull()
  })

  it('says the invoice was not found when the request fails', async () => {
    stub('error')

    await render()

    expect(await screen.findByText('Invoice not found')).toBeDefined()
    expect(screen.getByRole('link', { name: /payment history/i }).getAttribute('href')).toBe(
      '/payments',
    )
  })

  /** A 200 carrying no row is not an error, and must not render an empty receipt. */
  it('says the invoice was not found when the answer carries no transaction', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    await render()

    expect(await screen.findByText('Invoice not found')).toBeDefined()
  })

  it('asks for exactly the transaction named in the address', async () => {
    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(String(apiFetch.mock.calls[0][0])).toContain('/api/v1/payments/tx-1')
  })
})

describe('the receipt header', () => {
  it('names the project, the reference and the status', async () => {
    await render()

    expect(await screen.findByText('Marketplace UMKM Bandung')).toBeDefined()
    expect(screen.getByText('MID-88213')).toBeDefined()
    expect(screen.getByText('Completed')).toBeDefined()
  })

  /** The gateway has not answered yet, so the idempotency key is all there is. */
  it('falls back to the idempotency key when the gateway gave no reference', async () => {
    stub({ ...TXN, paymentGatewayRef: null })

    await render()

    expect(await screen.findByText('idem-abc')).toBeDefined()
  })

  it('shows a dash rather than a blank when no payment method is recorded', async () => {
    stub({ ...TXN, paymentMethod: null })

    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(fieldValue('Payment Method')).toBe('-')
  })

  it('names the recorded payment method when there is one', async () => {
    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(fieldValue('Payment Method')).toBe('bank_transfer')
  })

  it('renders a status the badge palette does not know without crashing', async () => {
    stub({ ...TXN, status: 'reversed' })

    await render()

    expect(await screen.findByText('reversed')).toBeDefined()
  })

  it('renders the date in Indonesian rather than as a raw timestamp', async () => {
    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(fieldValue('Date')).toContain('1 Agustus 2026')
  })
})

describe('the amount', () => {
  it('shows the total in grouped Rupiah', async () => {
    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(fieldValue('Total')).toMatch(/^Rp\s10\.000\.000$/)
  })

  it('names the transaction type in words rather than as a code', async () => {
    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(fieldValue('Type')).toBe('Escrow Release')
  })
})

/** The double-entry proof: the column a leg lands in is the whole point. */
describe('the ledger table', () => {
  it('puts a credit in the credit column and leaves debit empty', async () => {
    const { container } = await render()

    await screen.findByText('Escrow release')
    const row = ledgerRow(container, 'Escrow release')
    expect(row[1]).toBe('-')
    expect(row[2]).toMatch(/10\.000\.000/)
  })

  it('puts a debit in the debit column and leaves credit empty', async () => {
    const { container } = await render()

    await screen.findByText('Talent payout')
    const row = ledgerRow(container, 'Talent payout')
    expect(row[1]).toMatch(/7\.150\.000/)
    expect(row[2]).toBe('-')
  })

  it('shows a dash rather than a blank for a leg with no description', async () => {
    const { container } = await render()

    await screen.findByText('Talent payout')
    const descriptions = Array.from(container.querySelectorAll('tbody tr')).map(
      (tr) => tr.children[0].textContent,
    )
    expect(descriptions).toContain('-')
  })

  it('drops the table entirely when the transaction has no legs', async () => {
    stub({ ...TXN, ledgerEntries: [] })

    const { container } = await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(container.querySelector('table')).toBeNull()
  })
})

describe('the event timeline', () => {
  it('names each event and the status it moved to', async () => {
    await render()

    expect(await screen.findByText('escrow_created')).toBeDefined()
    expect(screen.getByText(/funds_released \(pending → completed\)/)).toBeDefined()
  })

  it('drops the timeline entirely when nothing has happened yet', async () => {
    stub({ ...TXN, events: [] })

    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(screen.queryByText('escrow_created')).toBeNull()
  })
})

/**
 * The invoice URL carries both ids, and a wrong pair hands the reader another
 * project's invoice, so the exact address is the assertion.
 */
describe('the invoice download', () => {
  it('opens the invoice for this project and milestone in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /download/i }))

    expect(open).toHaveBeenCalledTimes(1)
    expect(String(open.mock.calls[0][0])).toContain('/api/v1/projects/p-1/invoices/m-3.pdf')
    expect(open.mock.calls[0][1]).toBe('_blank')
    open.mockRestore()
  })

  /** Only milestones have a PDF; a BRD payment has nothing to download. */
  it('offers no download for a transaction with no milestone', async () => {
    stub({ ...TXN, milestoneId: null, type: 'brd_payment' })

    await render()

    await screen.findByText('Marketplace UMKM Bandung')
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
  })
})

/** Read one ledger row as the three cells a reader compares. */
function ledgerRow(container: HTMLElement, description: string): string[] {
  const row = Array.from(container.querySelectorAll('tbody tr')).find(
    (tr) => tr.children[0].textContent === description,
  )
  if (!row) throw new Error(`no ledger row for ${description}`)
  return Array.from(row.children).map((cell) => cell.textContent ?? '')
}
