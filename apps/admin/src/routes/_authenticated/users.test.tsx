// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { Route } from './users'

/**
 * Suspension is the most destructive control an operator has over an account:
 * it revokes a talent's ability to take work and an owner's ability to run a
 * project. The route gates it behind a two-step confirmation with a mandatory
 * written reason, and the reason is what lands in talent_penalties as the
 * audit record, so an empty one is not a cosmetic problem.
 *
 * These assert the gate holds from the operator's side -- that the first click
 * reaches no endpoint, and that nothing is sent until a reason exists.
 */

const VERIFIED_TALENT = {
  id: 'u-talent',
  email: 'ani@bytz.id',
  name: 'Ani Lestari',
  phone: '+628110001111',
  role: 'talent' as const,
  avatarUrl: null,
  isVerified: true,
  locale: 'id',
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
}

const SUSPENDED_OWNER = {
  ...VERIFIED_TALENT,
  id: 'u-owner',
  email: 'budi@bytz.id',
  name: 'Budi Santoso',
  role: 'owner' as const,
  isVerified: false,
}

const TALENT_DETAIL = {
  profile: {
    id: 'tp-1',
    userId: 'u-talent',
    bio: 'Frontend engineer',
    yearsOfExperience: 4,
    tier: 'mid',
    educationUniversity: 'ITB',
    educationMajor: 'Informatika',
    educationYear: 2021,
    location: 'Bandung',
    availabilityStatus: 'available',
    verificationStatus: 'verified',
    portfolioLinks: [],
    domainExpertise: [],
    totalProjectsCompleted: 3,
    totalProjectsActive: 1,
    averageRating: 4.5,
    pemerataanPenalty: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  skills: [
    {
      skillId: 's-1',
      skillName: 'React',
      category: 'frontend',
      proficiencyLevel: 'advanced',
      isPrimary: true,
    },
  ],
  penalties: [
    {
      id: 'p-1',
      type: 'warning',
      reason: 'Tidak ada progres 7 hari',
      relatedProjectId: null,
      issuedById: 'u-1',
      issuedByName: 'Admin',
      appealStatus: 'pending',
      appealNote: null,
      expiresAt: null,
      createdAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  projectHistory: [
    {
      assignmentId: 'a-1',
      projectId: 'p-1',
      projectTitle: 'Toko Online Kopi',
      projectStatus: 'completed',
      roleLabel: 'Frontend Developer',
      workPackageTitle: null,
      acceptanceStatus: 'accepted',
      assignmentStatus: 'completed',
      startedAt: '2026-02-01T00:00:00.000Z',
      completedAt: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  ],
}

/**
 * The same talent with every optional field absent.
 *
 * Each of these is a `??` or a ternary in the detail panel, and the populated
 * fixture above only ever exercises the present side. A talent who never
 * uploaded a rating or finished a project is the ordinary case for a new
 * account, not an edge case, and the panel has to read as "nothing yet"
 * rather than as "undefined".
 */
const SPARSE_DETAIL = {
  profile: {
    ...TALENT_DETAIL.profile,
    averageRating: null,
    educationMajor: null,
    educationYear: null,
  },
  skills: [],
  penalties: [],
  projectHistory: [],
}

/** Present-but-different: a secondary skill, a work package standing in for a
 *  missing role label, an assignment still running, an unappealed penalty. */
const PARTIAL_DETAIL = {
  profile: TALENT_DETAIL.profile,
  skills: [
    {
      skillId: 's-2',
      skillName: 'Figma',
      category: 'design',
      proficiencyLevel: 'intermediate',
      isPrimary: false,
    },
  ],
  penalties: [
    {
      ...TALENT_DETAIL.penalties[0],
      id: 'p-2',
      reason: 'Terlambat submit',
      issuedByName: null,
      issuedById: 'u-9',
      appealStatus: 'none',
    },
  ],
  projectHistory: [
    {
      ...TALENT_DETAIL.projectHistory[0],
      assignmentId: 'a-2',
      projectTitle: 'Aplikasi Absensi',
      roleLabel: null,
      workPackageTitle: 'Modul Laporan',
      assignmentStatus: 'active',
      projectStatus: 'in_progress',
      startedAt: null,
      completedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    {
      ...TALENT_DETAIL.projectHistory[0],
      assignmentId: 'a-3',
      projectTitle: 'Portal Karier',
      roleLabel: null,
      workPackageTitle: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ],
}

type Options = {
  rows?: Record<string, unknown>[]
  listFails?: boolean
  detailFails?: boolean
  detailEmpty?: boolean
  detail?: typeof TALENT_DETAIL | typeof SPARSE_DETAIL | typeof PARTIAL_DETAIL
  mutationFails?: boolean
  /** Leave the PATCH unsettled so the pending label stays on screen. */
  mutationHangs?: boolean
}

/**
 * The page fires the list query, three count queries and, for a talent, the
 * detail query. Routing on the URL keeps each answer the shape its consumer
 * expects; one blanket body makes an unrelated branch look broken.
 */
function stubFetch(options: Options = {}) {
  const rows = options.rows ?? [VERIFIED_TALENT]
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      if (options.mutationHangs) return new Promise<never>(() => {})
      if (options.mutationFails) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            success: false,
            error: { code: 'USER_CONFLICT', message: 'Sudah ditangguhkan' },
          }),
        }
      }
      const suspending = url.includes('/suspend')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { ...rows[0], isVerified: !suspending },
        }),
      }
    }
    if (url.includes('/talent-detail')) {
      if (options.detailFails) {
        return { ok: false, status: 500, json: async () => ({ success: false }) }
      }
      const detail = options.detailEmpty
        ? { profile: null, skills: [], penalties: [], projectHistory: [] }
        : (options.detail ?? TALENT_DETAIL)
      return { ok: true, status: 200, json: async () => ({ success: true, data: detail }) }
    }
    if (options.listFails) {
      return { ok: false, status: 500, json: async () => ({ success: false }) }
    }
    // pageSize=1 marks the per-role count queries; they only need the total.
    const isCount = url.includes('pageSize=1&') || url.endsWith('pageSize=1')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: isCount ? [] : rows,
          total: url.includes('role=owner') ? 40 : url.includes('role=talent') ? 88 : 128,
          page: 1,
          pageSize: isCount ? 1 : 100,
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

describe('user list', () => {
  it('renders each user with the figures the operator scans', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Ani Lestari')).toBeDefined()
    expect(screen.getByText('ani@bytz.id')).toBeDefined()
    expect(screen.getByText('+628110001111')).toBeDefined()
  })

  it('publishes the server total per role rather than the rendered page', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByRole('tab', { name: 'Semua User (128)' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Pemilik Proyek (40)' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Talenta (88)' })).toBeDefined()
  })

  it('shows an error row instead of a blank table when the list fails', async () => {
    stubFetch({ listFails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
  })

  it('shows the empty message when no user matches', async () => {
    stubFetch({ rows: [] })
    await renderPage()

    expect(await screen.findByText('Tidak ada user ditemukan')).toBeDefined()
  })

  it('narrows the query by role when a tab is chosen', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()

    await user.click(await screen.findByRole('tab', { name: /Pemilik Proyek/ }))

    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes('role=owner') && String(u).includes('100')),
      ).toBe(true),
    )
  })
})

describe('suspension', () => {
  async function openTalentPanel() {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))
    return { user, spy }
  }

  it('opens the detail panel for the selected user', async () => {
    await openTalentPanel()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Ani Lestari' })).toBeDefined()
  })

  /**
   * The first click must open the reason box and nothing else. If it reached
   * the endpoint, a misplaced click would revoke an account with no reason
   * recorded against it.
   */
  it('sends nothing on the first press of Suspend', async () => {
    const { user, spy } = await openTalentPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))

    expect(screen.getByText('Alasan Suspend')).toBeDefined()
    expect(patchCalls(spy)).toHaveLength(0)
  })

  it('keeps the confirm disabled until a reason is written', async () => {
    const { user } = await openTalentPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Konfirmasi Suspend' }).disabled,
    ).toBe(true)
  })

  /** Whitespace is not a reason; it would store an empty audit record. */
  it('still refuses to confirm on whitespace alone', async () => {
    const { user, spy } = await openTalentPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    await user.type(screen.getByRole('textbox', { name: '' }), '   ')

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Konfirmasi Suspend' }).disabled,
    ).toBe(true)
    expect(patchCalls(spy)).toHaveLength(0)
  })

  it('suspends only after the confirmation, carrying the reason and the acting admin', async () => {
    const { user, spy } = await openTalentPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    await user.type(screen.getByPlaceholderText('Masukkan alasan suspend...'), 'Spam proyek')
    await user.click(screen.getByRole('button', { name: 'Konfirmasi Suspend' }))

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    const [url, init] = patchCalls(spy)[0]
    expect(url).toBe('/api/v1/admin/users/u-talent/suspend')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      adminId: 'admin-1',
      reason: 'Spam proyek',
    })
  })

  it('abandons the suspension and clears the reason on cancel', async () => {
    const { user, spy } = await openTalentPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    await user.type(screen.getByPlaceholderText('Masukkan alasan suspend...'), 'Salah orang')
    await user.click(screen.getByRole('button', { name: 'Batal' }))

    expect(screen.queryByText('Alasan Suspend')).toBeNull()
    expect(patchCalls(spy)).toHaveLength(0)

    // Reopening starts from an empty reason, not the abandoned one.
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(
      screen.getByPlaceholderText<HTMLTextAreaElement>('Masukkan alasan suspend...').value,
    ).toBe('')
  })

  /** An operator with no session id must not be able to write an audit record. */
  it('sends nothing when the acting admin is unknown', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    const { user, spy } = await openTalentPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    await user.type(screen.getByPlaceholderText('Masukkan alasan suspend...'), 'Spam')
    await user.click(screen.getByRole('button', { name: 'Konfirmasi Suspend' }))

    expect(patchCalls(spy)).toHaveLength(0)
  })

  it('tells the operator when the suspension was rejected', async () => {
    const user = userEvent.setup()
    stubFetch({ mutationFails: true })
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    await user.type(screen.getByPlaceholderText('Masukkan alasan suspend...'), 'Spam')
    await user.click(screen.getByRole('button', { name: 'Konfirmasi Suspend' }))

    expect(await screen.findByText('Aksi gagal. Coba lagi.')).toBeDefined()
  })
})

describe('sorting and dismissal', () => {
  const SECOND = {
    ...VERIFIED_TALENT,
    id: 'u-2',
    name: 'Ahmad Zaki',
    email: 'ahmad@bytz.id',
    createdAt: '2025-12-01T00:00:00.000Z',
  }

  /** Rows are labelled by name, so the label order is the sorted order. */
  it.each(['Nama', 'Email'])('sorts the table by %s', async (header) => {
    const user = userEvent.setup()
    stubFetch({ rows: [VERIFIED_TALENT, SECOND] })
    await renderPage()
    await screen.findByText('Ani Lestari')

    await user.click(screen.getByRole('button', { name: header }))

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Ahmad Zaki', 'Ani Lestari'])
  })

  /** Joined sorts on the ISO timestamp, not the rendered short date. */
  it('sorts by join date oldest first', async () => {
    const user = userEvent.setup()
    stubFetch({ rows: [VERIFIED_TALENT, SECOND] })
    await renderPage()
    await screen.findByText('Ani Lestari')

    await user.click(screen.getByRole('button', { name: 'Bergabung' }))

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0].getAttribute('aria-label')).toBe('Ahmad Zaki')
  })

  it('closes the detail panel and forgets the selection', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))
    await screen.findByRole('dialog')

    await user.click(screen.getAllByRole('button', { name: 'Tutup panel' })[0])

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  /** An operator with no session id must not be able to restore access either. */
  it('reactivates nothing when the acting admin is unknown', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    const user = userEvent.setup()
    const spy = stubFetch({ rows: [SUSPENDED_OWNER] })
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Budi Santoso' }))

    await user.click(await screen.findByRole('button', { name: 'Aktifkan Kembali' }))

    expect(patchCalls(spy)).toHaveLength(0)
  })

  /** A talent row whose profile was never created must not blank the panel. */
  it('renders no talent sections when the profile is missing', async () => {
    const user = userEvent.setup()
    stubFetch({ detailEmpty: true })
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))

    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(screen.queryByText('Profil Talenta')).toBeNull()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeDefined()
  })
})

describe('reactivation', () => {
  /**
   * Restoring access is the non-destructive direction, so it is a single
   * press by design. Pinned so that reversing it later is a decision rather
   * than a regression.
   */
  it('reactivates a suspended account in one press', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ rows: [SUSPENDED_OWNER] })
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Budi Santoso' }))

    await user.click(await screen.findByRole('button', { name: 'Aktifkan Kembali' }))

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    const [url, init] = patchCalls(spy)[0]
    expect(url).toBe('/api/v1/admin/users/u-owner/unsuspend')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ adminId: 'admin-1' })
  })

  it('offers no suspend control for an already suspended account', async () => {
    const user = userEvent.setup()
    stubFetch({ rows: [SUSPENDED_OWNER] })
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Budi Santoso' }))

    expect(await screen.findByRole('button', { name: 'Aktifkan Kembali' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()
  })
})

describe('talent detail', () => {
  it('shows the internal tier and project counts an operator judges on', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))

    expect(await screen.findByText('Profil Talenta')).toBeDefined()
    expect(screen.getByText('mid')).toBeDefined()
    expect(screen.getByText('4.50')).toBeDefined()
    expect(screen.getByText('React')).toBeDefined()
    expect(screen.getByText('Toko Online Kopi')).toBeDefined()
  })

  it('shows the penalty history when the talent has one', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))

    expect(await screen.findByText('Riwayat Penalti')).toBeDefined()
    expect(screen.getByText('Tidak ada progres 7 hari')).toBeDefined()
  })

  /** A failed sub-query must not blank the panel the suspend control lives in. */
  it('keeps the admin actions reachable when the talent detail fails', async () => {
    const user = userEvent.setup()
    stubFetch({ detailFails: true })
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeDefined()
  })

  it('fetches no talent detail for an owner', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ rows: [SUSPENDED_OWNER] })
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Budi Santoso' }))
    await screen.findByRole('dialog')

    expect(spy.mock.calls.some(([u]) => String(u).includes('talent-detail'))).toBe(false)
  })
})

/**
 * A profile with the optional half missing.
 *
 * Every assertion here is the unused arm of a `??` or a ternary. The failure
 * they guard against is the one an operator cannot recover from on their own:
 * a panel reading "undefined" or "NaN" where a figure they are about to
 * suspend an account over should be, with no way to tell absent from zero.
 */
describe('a talent detail with nothing filled in', () => {
  async function openSparse(detail: Options['detail']) {
    const user = userEvent.setup()
    stubFetch({ detail })
    await renderPage()
    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))
    return within(await screen.findByRole('dialog'))
  }

  it('writes a dash for a rating the talent has not earned yet', async () => {
    const panel = await openSparse(SPARSE_DETAIL)

    await panel.findByText('Rating Rata-rata')
    expect(panel.queryByText('4.50')).toBeNull()
    expect(panel.queryByText(/NaN|undefined|null/)).toBeNull()
  })

  it('shows the university alone when major and year are unknown', async () => {
    const panel = await openSparse(SPARSE_DETAIL)

    const education = await panel.findByText('Pendidikan')
    expect(education.parentElement?.textContent).toContain('ITB')
    expect(education.parentElement?.textContent).not.toContain('—')
    expect(education.parentElement?.textContent).not.toContain('(')
  })

  it('says so rather than showing an empty list for skills and history', async () => {
    const panel = await openSparse(SPARSE_DETAIL)

    const skills = await panel.findByText('Keahlian')
    expect(skills.parentElement?.textContent).toContain('-')
    expect(panel.queryByText('React')).toBeNull()

    const history = panel.getByText('Riwayat Proyek')
    expect(history.parentElement?.textContent).toContain('-')
    expect(panel.queryByText('Toko Online Kopi')).toBeNull()
  })

  it('falls back to the work package when an assignment carries no role label', async () => {
    const panel = await openSparse(PARTIAL_DETAIL)

    expect(await panel.findByText('Aplikasi Absensi')).toBeDefined()
    expect(panel.getByText('Modul Laporan', { exact: false })).toBeDefined()
  })

  it('writes a dash when neither role label nor work package exists', async () => {
    const panel = await openSparse(PARTIAL_DETAIL)

    const entry = (await panel.findByText('Portal Karier')).parentElement
    expect(entry?.textContent).toContain('-')
    expect(entry?.textContent).not.toContain('undefined')
  })

  it('dates an unfinished assignment from its creation with no end arrow', async () => {
    const panel = await openSparse(PARTIAL_DETAIL)

    const entry = (await panel.findByText('Portal Karier')).parentElement
    expect(entry?.textContent).not.toContain('→')
  })

  it('identifies a penalty by admin id when the name did not resolve', async () => {
    const panel = await openSparse(PARTIAL_DETAIL)

    const reason = await panel.findByText('Terlambat submit')
    expect(reason.parentElement?.textContent).toContain('u-9')
  })

  it('shows no appeal marker on a penalty nobody appealed', async () => {
    const panel = await openSparse(PARTIAL_DETAIL)

    await panel.findByText('Terlambat submit')
    expect(panel.queryByText(/· pending/)).toBeNull()
  })

  it('renders a secondary skill differently from a primary one', async () => {
    const panel = await openSparse(PARTIAL_DETAIL)

    const skill = await panel.findByText('Figma', { exact: false })
    expect(skill.className).not.toContain('bg-success-500/20')
  })
})

/** A user row for an account that never verified a phone number. */
describe('a user with no phone number', () => {
  const NO_PHONE = { ...VERIFIED_TALENT, phone: null }

  it('writes a dash in the table rather than leaving the cell blank', async () => {
    stubFetch({ rows: [NO_PHONE] })
    await renderPage()

    const row = await screen.findByRole('row', { name: /Ani Lestari/ })
    expect(within(row).getByText('-')).toBeDefined()
  })

  it('writes a dash in the detail panel too', async () => {
    const user = userEvent.setup()
    stubFetch({ rows: [NO_PHONE] })
    await renderPage()

    await user.click(await screen.findByRole('row', { name: /Ani Lestari/ }))

    const panel = within(await screen.findByRole('dialog'))
    expect(panel.getByText('Telepon').parentElement?.textContent).toContain('-')
  })
})

/** The confirm button is the only feedback that a suspension is under way. */
describe('while the suspension is in flight', () => {
  it('replaces the confirm label with a pending one', async () => {
    const user = userEvent.setup()
    stubFetch({ mutationHangs: true })
    await renderPage()

    await user.click(await screen.findByRole('row', { name: 'Ani Lestari' }))
    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    // The reason textarea has no accessible name; see the note in the report.
    await user.type(screen.getByRole('textbox', { name: '' }), 'Tidak responsif')
    await user.click(screen.getByRole('button', { name: 'Konfirmasi Suspend' }))

    expect(await screen.findByRole('button', { name: 'Memproses...' })).toBeDefined()
  })
})
