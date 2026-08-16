// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRouteWithQuery } from '@/lib/testing/harness'
import { Route } from './projects'

/**
 * The read-only project console. Nothing here mutates, so what matters is that
 * the figures are the ones the operator would act on elsewhere: the price the
 * owner pays, the platform's cut of it, and the per-milestone amounts that a
 * dispute or refund would be argued over.
 *
 * A project priced by the engine shows its final price; one still being scoped
 * shows the owner's budget range instead, and the two must not be confused.
 */

const PRICED = {
  id: 'p-1',
  title: 'Toko Online Kopi',
  ownerId: 'u-owner',
  ownerName: 'Budi Santoso',
  ownerEmail: 'budi@bytz.id',
  status: 'in_progress',
  category: 'web_app',
  teamSize: 3,
  budgetMin: 10_000_000,
  budgetMax: 20_000_000,
  finalPrice: 18_000_000,
  platformFee: 6_030_000,
  estimatedTimelineDays: 60,
  progress: 55,
  createdAt: '2026-05-01T00:00:00.000Z',
}

const UNPRICED = {
  ...PRICED,
  id: 'p-2',
  title: 'Aplikasi Kasir Warung',
  status: 'scoping',
  category: 'mobile_app',
  finalPrice: null,
  platformFee: null,
  progress: 0,
  teamSize: 1,
  ownerName: '',
}

const DETAIL = {
  ...PRICED,
  description: 'Marketplace kopi lokal',
  projectType: 'company',
  companyName: 'PT Kopi Nusantara',
  companyRole: 'CTO',
  visibility: 'public_summary',
  completenessScore: 92,
  documentFileURL: null,
  documentFileType: null,
  talentPayout: 11_970_000,
  preferences: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  workPackages: [
    {
      id: 'wp-1',
      title: 'Backend API',
      description: '',
      orderIndex: 0,
      requiredSkills: ['go'],
      estimatedHours: 120,
      amount: 9_000_000,
      talentPayout: 5_985_000,
      status: 'in_progress',
    },
  ],
  workers: [
    {
      id: 'a-1',
      talentId: 'tp-1',
      talentUserId: 'u-talent',
      talentName: 'Ani Lestari',
      roleLabel: 'Backend Developer',
      workPackageId: 'wp-1',
      workPackageTitle: 'Backend API',
      acceptanceStatus: 'accepted',
      status: 'active',
      startedAt: '2026-05-10T00:00:00.000Z',
      completedAt: null,
      createdAt: '2026-05-09T00:00:00.000Z',
    },
  ],
  milestones: [
    {
      id: 'm-1',
      workPackageId: 'wp-1',
      assignedTalentId: 'tp-1',
      title: 'Autentikasi selesai',
      description: '',
      milestoneType: 'individual',
      orderIndex: 0,
      amount: 4_000_000,
      status: 'revision_requested',
      revisionCount: 2,
      dueDate: '2026-06-15T00:00:00.000Z',
      submittedAt: '2026-06-10T00:00:00.000Z',
    },
  ],
  transactions: [
    {
      id: 'tx-1',
      workPackageId: 'wp-1',
      milestoneId: 'm-1',
      talentId: 'tp-1',
      type: 'escrow_in',
      amount: 18_000_000,
      status: 'completed',
      paymentMethod: 'bank_transfer',
      createdAt: '2026-05-05T00:00:00.000Z',
    },
  ],
  disputes: [
    {
      id: 'd-1',
      workPackageId: 'wp-1',
      initiatedById: 'u-owner',
      initiatedByName: 'Budi Santoso',
      againstUserId: 'u-talent',
      againstUserName: 'Ani Lestari',
      reason: 'Deliverable tidak sesuai PRD',
      status: 'under_review',
      resolution: null,
      resolutionType: null,
      resolvedAt: null,
      createdAt: '2026-06-20T00:00:00.000Z',
    },
  ],
}

type Options = {
  rows?: unknown[]
  detail?: Record<string, unknown>
  listFails?: boolean
  detailFails?: boolean
}

function stubFetch(options: Options = {}) {
  const rows = options.rows ?? [PRICED, UNPRICED]
  const spy = vi.fn(async (url: string) => {
    // The detail path ends in the id; the list path carries a query string.
    if (/\/projects\/[^/?]+$/.test(url)) {
      if (options.detailFails) return { ok: false, status: 500, json: async () => ({}) }
      return {
        ok: true,
        json: async () => ({ success: true, data: options.detail ?? DETAIL }),
      }
    }
    if (options.listFails) return { ok: false, status: 500, json: async () => ({}) }
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { items: rows, total: rows.length, page: 1, pageSize: 100 },
      }),
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

describe('project list', () => {
  it('shows the title, category, owner and team size', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Toko Online Kopi')).toBeDefined()
    expect(screen.getByText('Web App')).toBeDefined()
    expect(screen.getByText('Budi Santoso')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
  })

  /** A priced project shows what the owner pays, not what they first guessed. */
  it('shows the engine price once the project has one', async () => {
    stubFetch({ rows: [PRICED] })
    await renderPage()

    expect(await screen.findByText('Rp 18 jt')).toBeDefined()
    expect(screen.queryByText(/Rp 10 jt - Rp 20 jt/)).toBeNull()
  })

  it('falls back to the owner budget range while the project is unpriced', async () => {
    stubFetch({ rows: [UNPRICED] })
    await renderPage()

    const range = await screen.findByText(/Rp 10 jt/)
    expect(range.textContent).toBe('Rp 10 jt - Rp 20 jt')
  })

  it('falls back to the owner email when no name is stored', async () => {
    stubFetch({ rows: [UNPRICED] })
    await renderPage()

    expect(await screen.findByText('budi@bytz.id')).toBeDefined()
  })

  it('shows an unmapped category as its raw key rather than blank', async () => {
    stubFetch({ rows: [{ ...PRICED, category: 'hardware' }] })
    await renderPage()

    expect(await screen.findByText('hardware')).toBeDefined()
  })

  it.each([
    [90, 'text-success-500'],
    [55, 'text-warning-500'],
    [10, 'text-warning-600'],
    [0, 'text-neutral-300'],
  ])('bands %d%% progress by colour', async (progress, expected) => {
    stubFetch({ rows: [{ ...PRICED, progress }] })
    await renderPage()

    expect((await screen.findByText(`${progress}%`)).className).toContain(expected)
  })

  it('reports a failed list without blanking the table', async () => {
    stubFetch({ listFails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
  })

  it('says so when no project matches', async () => {
    stubFetch({ rows: [] })
    await renderPage()

    expect(await screen.findByText('Tidak ada proyek ditemukan')).toBeDefined()
  })

  it('counts the projects it is showing', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Menampilkan 2 proyek')).toBeDefined()
  })

  it('narrows the list by status', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status' }), 'in_progress')

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('status=in_progress'))).toBe(true),
    )
  })

  it('searches by title once the term settles', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.type(await screen.findByRole('textbox'), 'kopi')

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('search=kopi'))).toBe(true),
    )
  })
})

describe('sorting', () => {
  const SECOND = {
    ...PRICED,
    id: 'p-3',
    title: 'Aplikasi Absensi',
    ownerName: 'Ahmad Zaki',
    progress: 10,
    teamSize: 1,
    createdAt: '2025-12-01T00:00:00.000Z',
  }

  /**
   * Rows are labelled by title, so the label order is the sorted order.
   * Progress and team size sort numerically; as strings "10" would come before
   * "3" and the operator would read the ordering backwards.
   */
  it.each([
    ['Proyek', ['Aplikasi Absensi', 'Toko Online Kopi']],
    ['Pemilik Proyek', ['Aplikasi Absensi', 'Toko Online Kopi']],
    // `progress` has no Indonesian entry, so the inline default renders.
    ['Progress', ['Aplikasi Absensi', 'Toko Online Kopi']],
    ['Team', ['Aplikasi Absensi', 'Toko Online Kopi']],
    ['Dibuat', ['Aplikasi Absensi', 'Toko Online Kopi']],
  ])('sorts the table by %s', async (header, expected) => {
    const user = userEvent.setup()
    stubFetch({ rows: [PRICED, SECOND] })
    await renderPage()
    await screen.findByText('Toko Online Kopi')

    await user.click(screen.getByRole('button', { name: header }))

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(expected)
  })
})

describe('project detail', () => {
  async function openDetail(options: Options = {}) {
    const user = userEvent.setup()
    const spy = stubFetch(options)
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Toko Online Kopi' }))
    return { user, spy }
  }

  /** Scoped to the info card: the escrow transaction below repeats the price. */
  it('shows the price and the platform cut of it', async () => {
    await openDetail()
    const info = (await screen.findByRole('heading', { name: 'Info Proyek' }))
      .parentElement as HTMLElement

    expect(within(info).getByText('Rp 18 jt')).toBeDefined()
    // 33.5% of Rp 18 juta under the locked bracket.
    expect(within(info).getByText('Rp 6 jt')).toBeDefined()
  })

  it('shows a dash for the platform fee before the project is priced', async () => {
    await openDetail({ detail: { ...DETAIL, finalPrice: null, platformFee: null } })
    const info = (await screen.findByRole('heading', { name: 'Info Proyek' }))
      .parentElement as HTMLElement

    expect(within(info).getByText('-')).toBeDefined()
    // Unpriced falls back to the owner's range.
    expect(within(info).getByText('Rp 10 jt - Rp 20 jt')).toBeDefined()
  })

  it('lists the work packages with hours and amount', async () => {
    await openDetail()

    expect(await screen.findByText('Backend API')).toBeDefined()
    expect(screen.getByText('Rp 9 jt')).toBeDefined()
    expect(screen.getByText(/120h/)).toBeDefined()
  })

  it('lists the assigned team with each role', async () => {
    await openDetail()

    expect(await screen.findByText('Ani Lestari')).toBeDefined()
    expect(screen.getByText('Backend Developer')).toBeDefined()
  })

  it('lists milestones with their amount, due date and revision count', async () => {
    await openDetail()

    expect(await screen.findByText('Autentikasi selesai')).toBeDefined()
    expect(screen.getByText('Rp 4 jt')).toBeDefined()
    expect(screen.getByText('· 2 rev')).toBeDefined()
    expect(screen.getByText('revision requested')).toBeDefined()
  })

  it('omits the revision count when there have been none', async () => {
    await openDetail({
      detail: { ...DETAIL, milestones: [{ ...DETAIL.milestones[0], revisionCount: 0 }] },
    })

    await screen.findByText('Autentikasi selesai')
    expect(screen.queryByText(/rev$/)).toBeNull()
  })

  /** Money in, money out and money back each need to read differently. */
  it.each([
    ['escrow_release', 'escrow release', 'text-success-500'],
    ['partial_refund', 'partial refund', 'text-error-500'],
    ['escrow_in', 'escrow in', 'text-warning-500'],
  ])('colours a %s transaction as its direction', async (type, label, expected) => {
    await openDetail({
      detail: { ...DETAIL, transactions: [{ ...DETAIL.transactions[0], type }] },
    })

    expect((await screen.findByText(label)).className).toContain(expected)
  })

  /** Disputes get the danger tone; they are why an operator opened the panel. */
  it('marks the dispute section apart and names both parties', async () => {
    await openDetail()

    const heading = await screen.findByRole('heading', { name: /Dispute/ })
    expect(heading.className).toContain('text-error-500')
    expect(screen.getByText('Budi Santoso → Ani Lestari')).toBeDefined()
    expect(screen.getByText('Deliverable tidak sesuai PRD')).toBeDefined()
  })

  it('omits a section the project has nothing in', async () => {
    await openDetail({
      detail: {
        ...DETAIL,
        workPackages: [],
        workers: [],
        milestones: [],
        transactions: [],
        disputes: [],
      },
    })

    await screen.findByRole('dialog')
    expect(screen.queryByText('Backend API')).toBeNull()
    expect(screen.queryByRole('heading', { name: /Dispute/ })).toBeNull()
  })

  it('reports a failed detail without closing the panel', async () => {
    await openDetail({ detailFails: true })

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('closes the panel again', async () => {
    const { user } = await openDetail()
    await screen.findByRole('dialog')

    await user.click(screen.getAllByRole('button', { name: 'Tutup panel' })[0])

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

/**
 * What the console does with a row it does not recognise.
 *
 * Every badge map here is keyed on a database enum, and the console ships
 * separately from the migration that adds a value to one. The fallback arms
 * are what stands between "a status this build has not heard of" and an
 * unstyled or blank cell in the middle of an operator's triage.
 */
describe('values the console does not recognise', () => {
  const UNKNOWN_STATUS = {
    ...PRICED,
    id: 'p-9',
    title: 'Proyek Aneh',
    status: 'archived',
    ownerName: '',
    ownerEmail: '',
  }

  it('still labels and styles a status added after this build', async () => {
    stubFetch({ rows: [UNKNOWN_STATUS] })
    await renderPage()

    const row = await screen.findByRole('row', { name: 'Proyek Aneh' })
    const badge = within(row).getByText('archived')
    expect(badge.className).toContain('bg-neutral-500/20')
  })

  it('writes a dash for an owner with neither name nor email', async () => {
    stubFetch({ rows: [UNKNOWN_STATUS] })
    await renderPage()

    const row = await screen.findByRole('row', { name: 'Proyek Aneh' })
    expect(within(row).getByText('-')).toBeDefined()
  })

  /** Sorting reads the same fallback chain the cell does. */
  it('sorts a nameless owner by their email instead', async () => {
    const user = userEvent.setup()
    stubFetch({
      rows: [PRICED, { ...UNPRICED, ownerName: '', ownerEmail: 'aan@bytz.id' }],
    })
    await renderPage()
    await screen.findByText('Toko Online Kopi')

    await user.click(screen.getByRole('button', { name: 'Pemilik Proyek' }))

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Aplikasi Kasir Warung',
      'Toko Online Kopi',
    ])
  })
})

/** The same fallbacks, one level down, in the detail panel. */
describe('a detail panel full of gaps', () => {
  const SPARSE_DETAIL = {
    ...DETAIL,
    category: 'blockchain',
    status: 'archived',
    ownerName: '',
    workers: [
      {
        ...DETAIL.workers[0],
        id: 'a-1',
        talentName: null,
        talentId: 'tp-unknown',
        roleLabel: null,
        workPackageTitle: 'Backend API',
      },
      {
        ...DETAIL.workers[0],
        id: 'a-2',
        talentName: null,
        talentId: 'tp-other',
        roleLabel: null,
        workPackageTitle: null,
      },
    ],
    milestones: [{ ...DETAIL.milestones[0], status: 'escalated' }],
    disputes: [
      {
        ...DETAIL.disputes[0],
        initiatedByName: null,
        initiatedById: 'u-777',
        againstUserName: null,
        againstUserId: 'u-888',
      },
    ],
  }

  async function openSparse() {
    const user = userEvent.setup()
    stubFetch({ rows: [{ ...PRICED, title: 'Proyek Aneh' }], detail: SPARSE_DETAIL })
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Proyek Aneh' }))
    return within(await screen.findByRole('dialog'))
  }

  it('shows the raw category and the owner email in the subtitle', async () => {
    const panel = await openSparse()

    const subtitle = await panel.findByText(/blockchain/)
    expect(subtitle.textContent).toContain('budi@bytz.id')
  })

  it('styles an unknown project status with the neutral badge', async () => {
    const panel = await openSparse()

    const badge = await panel.findByText('archived')
    expect(badge.className).toContain('bg-neutral-500/20')
  })

  it('styles an unknown milestone status with the pending badge', async () => {
    const panel = await openSparse()

    const badge = await panel.findByText('escalated')
    expect(badge.className).toContain('bg-neutral-500/20')
  })

  it('identifies an unnamed talent by id and initials it with a placeholder', async () => {
    const panel = await openSparse()

    expect(await panel.findByText('tp-unknown')).toBeDefined()
    expect(panel.getAllByText('?').length).toBeGreaterThan(0)
  })

  it('falls back to the work package, then to a dash, for a missing role', async () => {
    const panel = await openSparse()

    await panel.findByText('tp-unknown')
    expect(panel.getAllByText('Backend API').length).toBeGreaterThan(0)
    expect(panel.getByText('tp-other').parentElement?.textContent).toContain('-')
  })

  it('names both sides of a dispute by id when the names did not resolve', async () => {
    const panel = await openSparse()

    const line = await panel.findByText(/u-777/)
    expect(line.textContent).toContain('u-888')
  })
})
