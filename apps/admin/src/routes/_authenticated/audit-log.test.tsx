// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { Route } from './audit-log'

/**
 * admin_audit_logs is the record of every intervention an operator made:
 * suspensions, reassignments, config changes. It is retained for five years
 * under the compliance policy, and this page is the only way anybody reads it.
 *
 * The category shown against each row is derived here from the action string
 * rather than stored, so the mapping is this app's, and a prefix falling
 * through to "system" silently mislabels an action in the audit trail.
 */

const ENTRIES = [
  {
    id: 'al-1',
    adminId: '0197f2b1-1111-7000-8000-000000000001',
    adminName: 'Rina Admin',
    adminEmail: 'rina@bytz.id',
    action: 'user.suspend',
    targetType: 'user',
    targetId: 'u-talent',
    details: { reason: 'Spam proyek', previous: { isVerified: true } },
    createdAt: '2026-07-24T09:15:00.000Z',
  },
  {
    id: 'al-2',
    adminId: '0197f2b1-2222-7000-8000-000000000002',
    adminName: null,
    adminEmail: null,
    action: 'settings.update',
    targetType: 'config',
    targetId: 'matching_weights',
    details: null,
    createdAt: '2026-07-25T11:00:00.000Z',
  },
]

type Options = { rows?: unknown[]; total?: number; fails?: boolean; hang?: boolean }

function stubFetch(options: Options = {}) {
  const rows = options.rows ?? ENTRIES
  const spy = vi.fn(async (url: string) => {
    if (options.hang) return new Promise(() => {}) as never
    if (options.fails) return { ok: false, status: 500, json: async () => ({}) }
    const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? 1)
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          // Second page carries a distinguishable row.
          items: page === 1 ? rows : [{ ...ENTRIES[0], id: 'al-9', action: 'project.reassign' }],
          total: options.total ?? rows.length,
          page,
          pageSize: 50,
        },
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

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audit trail', () => {
  it('shows who did what to which target', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('user.suspend')).toBeDefined()
    expect(screen.getByText('Rina Admin')).toBeDefined()
    expect(screen.getByText('u-talent')).toBeDefined()
  })

  /** The reason is the whole point of the record; it must not be dropped. */
  it('flattens the detail object into a readable line', async () => {
    stubFetch()
    await renderPage()

    const details = await screen.findByText(/reason: Spam proyek/)
    expect(details.textContent).toContain('previous: {"isVerified":true}')
  })

  it('renders an empty detail cell rather than the word null', async () => {
    stubFetch()
    await renderPage()

    await screen.findByText('settings.update')
    expect(screen.queryByText('null')).toBeNull()
  })

  /** Older rows predate admin names being denormalised onto the log. */
  it('falls back to a truncated admin id when the name is missing', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('0197f2b1')).toBeDefined()
  })

  it('counts the rows it is showing', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Menampilkan 2 entri')).toBeDefined()
  })

  it('says it is loading before the first page arrives', async () => {
    stubFetch({ hang: true })
    await renderPage()

    expect(screen.getByText('Memuat...')).toBeDefined()
  })

  it('reports a failed query instead of an empty trail', async () => {
    stubFetch({ fails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
  })

  it('says so when the trail is empty', async () => {
    stubFetch({ rows: [] })
    await renderPage()

    expect(await screen.findByText('Tidak ada entri audit ditemukan')).toBeDefined()
  })
})

describe('action categories', () => {
  /**
   * Derived from the action prefix. finance covers three prefixes and config
   * covers three more, so each alias needs its own case: an unmapped prefix
   * falls through to system and the row is filed under the wrong category.
   */
  it.each([
    ['user.suspend', 'Aksi User'],
    ['project.reassign', 'Aksi Proyek'],
    ['finance.refund', 'Aksi Keuangan'],
    ['payment.release', 'Aksi Keuangan'],
    ['transaction.void', 'Aksi Keuangan'],
    ['dispute.resolve', 'Aksi Dispute'],
    ['config.update', 'Perubahan Konfigurasi'],
    ['setting.update', 'Perubahan Konfigurasi'],
    ['settings.update', 'Perubahan Konfigurasi'],
  ])('files %s under %s', async (action, category) => {
    const user = userEvent.setup()
    stubFetch({ rows: [{ ...ENTRIES[0], action }] })
    await renderPage()
    await screen.findByText(action)

    await user.selectOptions(screen.getByRole('combobox'), category)

    expect(screen.getByText(action)).toBeDefined()
  })

  it('files an unrecognised prefix under system rather than dropping it', async () => {
    const user = userEvent.setup()
    stubFetch({ rows: [{ ...ENTRIES[0], action: 'export.csv' }] })
    await renderPage()
    await screen.findByText('export.csv')

    await user.selectOptions(screen.getByRole('combobox'), 'Aksi Sistem')

    expect(screen.getByText('export.csv')).toBeDefined()
  })

  it('hides rows outside the chosen category', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()
    await screen.findByText('user.suspend')

    await user.selectOptions(screen.getByRole('combobox'), 'Perubahan Konfigurasi')

    expect(screen.queryByText('user.suspend')).toBeNull()
    expect(screen.getByText('settings.update')).toBeDefined()
  })
})

describe('search', () => {
  it.each([
    ['suspend', 'user.suspend'],
    ['matching_weights', 'settings.update'],
    ['Rina', 'user.suspend'],
  ])('matches %s against the loaded page', async (term, expected) => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()
    await screen.findByText('user.suspend')

    await user.type(screen.getByPlaceholderText('Cari berdasarkan aksi atau target...'), term)

    expect(screen.getByText(expected)).toBeDefined()
  })

  it('is case insensitive', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()
    await screen.findByText('user.suspend')

    await user.type(screen.getByPlaceholderText('Cari berdasarkan aksi atau target...'), 'SUSPEND')

    expect(screen.getByText('user.suspend')).toBeDefined()
  })

  it('says so when nothing on the page matches', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()
    await screen.findByText('user.suspend')

    await user.type(screen.getByPlaceholderText('Cari berdasarkan aksi atau target...'), 'zzzz')

    expect(screen.getByText('Tidak ada entri audit ditemukan')).toBeDefined()
  })
})

describe('pagination', () => {
  /**
   * Search and category filter only the page that was fetched, so without page
   * controls everything past the newest fifty rows is unreachable.
   */
  it('reports the total number of pages', async () => {
    stubFetch({ total: 120 })
    await renderPage()

    expect(await screen.findByText(/Halaman 1 \/ 3/)).toBeDefined()
  })

  it('holds Previous shut on the first page', async () => {
    stubFetch({ total: 120 })
    await renderPage()

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sebelumnya' }).disabled).toBe(
        true,
      ),
    )
  })

  it('fetches the next page and can come back', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ total: 120 })
    await renderPage()
    await screen.findByText('user.suspend')

    await user.click(screen.getByRole('button', { name: 'Berikutnya' }))

    expect(await screen.findByText('project.reassign')).toBeDefined()
    expect(spy.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Sebelumnya' }))
    expect(await screen.findByText('user.suspend')).toBeDefined()
  })

  it('holds Next shut on the last page', async () => {
    stubFetch({ total: 2 })
    await renderPage()

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Berikutnya' }).disabled).toBe(
        true,
      ),
    )
  })
})
