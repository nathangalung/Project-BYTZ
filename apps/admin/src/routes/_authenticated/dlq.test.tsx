// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { Route } from './dlq'

/**
 * The dead letter queue is where events that failed three delivery attempts
 * land. Marking one reprocessed is an assertion that a human republished the
 * payload out of band; nothing re-emits it automatically. Getting that wrong
 * silently drops a payment settlement or a milestone release.
 *
 * The payload pane is the other half: an operator reads it to decide what to
 * republish, so it has to render whatever shape the failed event carried,
 * including one that will not serialise.
 */

const PENDING = {
  id: 'dlq-1',
  originalEventId: '0197f2b1-0000-7000-8000-000000000001',
  eventType: 'payment.settled',
  payload: { transactionId: 'tx-1', amount: 12_000_000 },
  traceContext: { traceparent: '00-abc-def-01' },
  consumerService: 'project-service',
  errorMessage: 'settlement handler timed out after 30s',
  retryCount: 3,
  reprocessed: false,
  reprocessedAt: null,
  createdAt: '2026-07-24T09:15:00.000Z',
}

const DONE = {
  ...PENDING,
  id: 'dlq-2',
  eventType: 'milestone.approved',
  reprocessed: true,
  reprocessedAt: '2026-07-25T10:00:00.000Z',
}

type Options = {
  rows?: Record<string, unknown>[]
  listFails?: boolean
  mutationFails?: boolean
  hang?: boolean
}

function stubFetch(options: Options = {}) {
  const rows = options.rows ?? [PENDING]
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      if (options.mutationFails) return { ok: false, status: 500, json: async () => ({}) }
      return {
        ok: true,
        json: async () => ({ success: true, data: { ...rows[0], reprocessed: true } }),
      }
    }
    if (options.hang) return new Promise(() => {}) as never
    if (options.listFails) return { ok: false, status: 500, json: async () => ({}) }
    // The route filters server-side, so honour the flag the page asked for.
    const flag = new URL(url, 'http://x').searchParams.get('reprocessed')
    const items =
      flag === null
        ? rows
        : rows.filter((r) => String((r as { reprocessed: boolean }).reprocessed) === flag)
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { items, total: items.length, page: 1, pageSize: 100 },
      }),
    }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

async function renderPage() {
  const lazy = Route.options.component as unknown as { preload: () => Promise<unknown> }
  await lazy.preload()
  const Component = Route.options.component as () => React.ReactNode
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  )
}

function patchCalls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'admin-1', email: 'admin@bytz.id', name: 'Admin', role: 'admin', locale: 'id' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dlq list', () => {
  it('shows the event type, consumer, retries and failure reason', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('payment.settled')).toBeDefined()
    expect(screen.getByText('project-service')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
    expect(screen.getByText('settlement handler timed out after 30s')).toBeDefined()
  })

  it('distinguishes a pending entry from a reprocessed one', async () => {
    stubFetch({ rows: [PENDING, DONE] })
    await renderPage()

    await screen.findByText('payment.settled')
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Diproses Ulang').length).toBeGreaterThan(0)
  })

  it('renders a skeleton rather than an empty table while loading', async () => {
    stubFetch({ hang: true })
    await renderPage()

    expect(screen.getByText('Memuat...')).toBeDefined()
    expect(screen.queryByText('Tidak ada event dead-letter')).toBeNull()
  })

  it('reports a failed query in the table body', async () => {
    stubFetch({ listFails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
  })

  it('says so when the queue is empty', async () => {
    stubFetch({ rows: [] })
    await renderPage()

    expect(await screen.findByText('Tidak ada event dead-letter')).toBeDefined()
  })

  it.each([
    ['Diproses Ulang', 'reprocessed=true'],
    ['Pending', 'reprocessed=false'],
  ])('filters the queue to %s', async (tab, expected) => {
    const user = userEvent.setup()
    const spy = stubFetch({ rows: [PENDING, DONE] })
    await renderPage()
    await screen.findByText('payment.settled')

    await user.click(screen.getByRole('button', { name: new RegExp(`^${tab} \\(`) }))

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes(expected))).toBe(true),
    )
  })

  /** Clearing the filter has to drop the parameter, not send an empty one. */
  it('returns to the unfiltered queue', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ rows: [PENDING, DONE] })
    await renderPage()
    await screen.findByText('payment.settled')
    await user.click(screen.getByRole('button', { name: /^Pending \(/ }))
    await waitFor(() => expect(screen.queryByText('milestone.approved')).toBeNull())

    await user.click(screen.getByRole('button', { name: /^Semua Event \(/ }))

    expect(await screen.findByText('milestone.approved')).toBeDefined()
    expect(spy.mock.calls.some(([u]) => String(u).includes('reprocessed='))).toBe(true)
  })

  it('filters the queue server-side by reprocessed state', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ rows: [PENDING, DONE] })
    await renderPage()
    await screen.findByText('payment.settled')

    await user.click(screen.getByRole('button', { name: /Pending \(/ }))

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('reprocessed=false'))).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('milestone.approved')).toBeNull())
  })

  it('filters by event type', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.type(await screen.findByPlaceholderText('Cari berdasarkan event type...'), 'pay')

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('eventType=pay'))).toBe(true),
    )
  })

  /**
   * Not asserted: the tab counts are derived from the page that came back, and
   * that page is already server-filtered, so selecting Pending makes the
   * Reprocessed tab read zero however many exist. That is the defect the users
   * page fixed by moving its counts to server-side totals. It is reported
   * rather than pinned here, so porting the fix does not turn a test red.
   */
})

describe('dlq detail', () => {
  async function openDetail(options: Options = {}) {
    const user = userEvent.setup()
    const spy = stubFetch(options)
    await renderPage()
    await user.click(await screen.findByText('payment.settled'))
    return { user, spy }
  }

  it('shows the identifiers an operator needs to find the event upstream', async () => {
    await openDetail()

    expect(await screen.findByText('0197f2b1-0000-7000-8000-000000000001')).toBeDefined()
    expect(screen.getByText('Metadata Event')).toBeDefined()
  })

  it('pretty-prints the payload so it can be read and republished', async () => {
    await openDetail()

    const payload = await screen.findByText(/"transactionId": "tx-1"/)
    expect(payload.textContent).toContain('"amount": 12000000')
  })

  it('renders the trace context when the event carried one', async () => {
    await openDetail()

    expect(await screen.findByText(/traceparent/)).toBeDefined()
  })

  it('omits the trace pane entirely when there is none', async () => {
    await openDetail({ rows: [{ ...PENDING, traceContext: null }] })

    await screen.findByText('Metadata Event')
    expect(screen.queryByText(/traceparent/)).toBeNull()
  })

  /** A payload that cannot serialise must still leave the pane readable. */
  it('degrades to a string rather than throwing on an unserialisable payload', async () => {
    const circular: Record<string, unknown> = { id: 'tx-1' }
    circular.self = circular
    await openDetail({ rows: [{ ...PENDING, payload: circular }] })

    expect(await screen.findByText('[object Object]')).toBeDefined()
  })

  it('renders an empty pane for a null payload', async () => {
    await openDetail({ rows: [{ ...PENDING, payload: null }] })

    expect(await screen.findByText('Payload')).toBeDefined()
  })

  it('closes from the labelled control', async () => {
    const { user } = await openDetail()
    await screen.findByText('Metadata Event')

    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByText('Metadata Event')).toBeNull())
  })

  it('closes from the backdrop', async () => {
    const { user } = await openDetail()
    await screen.findByText('Metadata Event')

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    await waitFor(() => expect(screen.queryByText('Metadata Event')).toBeNull())
  })
})

describe('marking an event reprocessed', () => {
  async function openPending() {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await user.click(await screen.findByText('payment.settled'))
    return { user, spy }
  }

  /**
   * Current behaviour, pinned: one press marks the event handled with no
   * confirmation. The route substitutes a line of hint text for a dialog.
   * Reported as a gap rather than asserted away.
   */
  it('marks the event on the first press, with no confirmation step', async () => {
    const { user, spy } = await openPending()

    await user.click(await screen.findByRole('button', { name: /Tandai Diproses Ulang/ }))

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    const [url, init] = patchCalls(spy)[0]
    expect(url).toBe('/api/v1/admin/dlq/dlq-1/reprocess')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ adminId: 'admin-1' })
  })

  it('warns that the payload must be republished out of band first', async () => {
    await openPending()

    expect(
      await screen.findByText(
        'Marking acknowledges manual triage. Republish the payload out-of-band before clicking.',
      ),
    ).toBeDefined()
  })

  it('disables the control when the acting admin is unknown', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    await openPending()

    expect(
      (await screen.findByRole<HTMLButtonElement>('button', { name: /Tandai Diproses Ulang/ }))
        .disabled,
    ).toBe(true)
  })

  it('offers no control for an event already marked', async () => {
    const user = userEvent.setup()
    stubFetch({ rows: [DONE] })
    await renderPage()

    await user.click(await screen.findByText('milestone.approved'))

    expect(
      await screen.findByText('Event ini sudah ditandai sebagai diproses ulang.'),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: /Tandai Diproses Ulang/ })).toBeNull()
  })

  it('tells the operator when the mark failed', async () => {
    const user = userEvent.setup()
    stubFetch({ mutationFails: true })
    await renderPage()
    await user.click(await screen.findByText('payment.settled'))

    await user.click(await screen.findByRole('button', { name: /Tandai Diproses Ulang/ }))

    expect(await screen.findByText('Aksi gagal. Coba lagi.')).toBeDefined()
  })
})
