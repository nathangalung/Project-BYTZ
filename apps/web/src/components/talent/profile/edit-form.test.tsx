// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ProfileCompletenessCard } from './completeness'
import { ProfileEditForm } from './edit-form'
import type { TalentProfile } from './shared'

/**
 * The talent editing their own profile.
 *
 * Two things here are not cosmetic. The save is an upsert over the whole row,
 * so a draft that loses a field silently erases it; and the display name lives
 * on the user rather than on the profile, so it takes a second write and the
 * auth store has to hear about it or the heading stays stale.
 */

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const t = i18n.getFixedT('id', 'talent')

const PROFILE: TalentProfile = {
  id: 'tp-1',
  userId: 'u-1',
  bio: 'Membangun marketplace.',
  yearsOfExperience: 4,
  tier: 'mid',
  educationUniversity: 'ITB',
  educationMajor: 'Informatika',
  educationYear: 2019,
  location: 'Bandung',
  cvFileUrl: 'cv/ari.pdf',
  portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/ari' }],
  availabilityStatus: 'available',
  verificationStatus: 'verified',
  domainExpertise: ['Fintech'],
  totalProjectsCompleted: 3,
  totalProjectsActive: 1,
  averageRating: 4.5,
  skills: [{ name: 'React', category: 'frontend', proficiencyLevel: 'advanced', isPrimary: true }],
}

const USER = {
  id: 'u-1',
  email: 'ari@example.test',
  name: 'Ari',
  role: 'talent' as const,
  locale: 'id' as const,
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ success: true, data: { profileId: 'tp-1' } })
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ user: USER, isAuthenticated: true, isLoading: false })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderForm(overrides: Partial<TalentProfile> = {}, name = 'Ari') {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProfileEditForm
        profile={{ ...PROFILE, ...overrides }}
        userId="u-1"
        userName={name}
        t={t}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { onClose, user: userEvent.setup() }
}

/** The JSON body sent to one path, or a named failure if it was never called. */
function sentTo(path: string): Record<string, unknown> {
  const call = apiFetch.mock.calls.find(([called]) => called === path)
  if (!call) throw new Error(`no request was sent to ${path}`)
  return JSON.parse((call[1] as RequestInit).body as string)
}

const savedProfile = () => sentTo('/api/v1/talent-profiles')

const savedSkills = () =>
  savedProfile().skills as { name: string; proficiencyLevel: string; isPrimary: boolean }[]

const toastMessages = () => useToastStore.getState().toasts.map((toast) => toast.message)

describe('saving', () => {
  it('sends every editable field, including the ones nothing touched', async () => {
    const { user, onClose } = renderForm()

    await user.clear(screen.getByLabelText('Tentang Diri'))
    await user.type(screen.getByLabelText('Tentang Diri'), 'Bio baru')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(savedProfile()).toMatchObject({
      userId: 'u-1',
      yearsOfExperience: 4,
      bio: 'Bio baru',
      location: 'Bandung',
      educationUniversity: 'ITB',
      educationMajor: 'Informatika',
      educationYear: 2019,
      skills: [{ name: 'React', proficiencyLevel: 'advanced', isPrimary: true }],
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/ari' }],
      domainExpertise: ['Fintech'],
    })
    expect(toastMessages()).toContain('Profil berhasil diperbarui')
  })

  it('leaves the name alone when it was not edited', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls.map(([path]) => path)).not.toContain('/api/v1/me')
  })

  /**
   * The heading reads the name from the auth store, not from the profile
   * query, so a write that skipped the store would look like it had failed.
   */
  it('writes an edited name to the user and to the auth store', async () => {
    const { user } = renderForm()

    await user.clear(screen.getByLabelText('Nama Lengkap'))
    await user.type(screen.getByLabelText('Nama Lengkap'), 'Ari Wibowo')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe('Ari Wibowo'))
    expect(sentTo('/api/v1/me')).toEqual({ name: 'Ari Wibowo' })
  })

  it('reports a failed save instead of closing the form', async () => {
    apiFetch.mockRejectedValue(new Error('Profil ditolak server'))
    const { user, onClose } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(toastMessages()).toContain('Profil ditolak server'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('falls back to its own message when the failure carries none', async () => {
    apiFetch.mockRejectedValue('offline')
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(toastMessages()).toContain('Gagal memperbarui profil'))
  })

  it('discards the draft when the talent cancels', async () => {
    const { user, onClose } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Batal' }))

    expect(onClose).toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('carries every text field the talent retyped', async () => {
    const { user } = renderForm()

    for (const [label, value] of [
      ['Lokasi', 'Yogyakarta'],
      ['Universitas', 'UGM'],
      ['Jurusan', 'Ilmu Komputer'],
      ['Tahun Lulus', '2022'],
      ['Pengalaman (tahun)', '7'],
    ]) {
      await user.clear(screen.getByLabelText(label))
      await user.type(screen.getByLabelText(label), value)
    }
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile()).toMatchObject({
      location: 'Yogyakarta',
      educationUniversity: 'UGM',
      educationMajor: 'Ilmu Komputer',
      educationYear: 2022,
      yearsOfExperience: 7,
    })
  })

  /** A second press while the first save is in flight would write twice. */
  it('shuts the save button while the write is in flight', async () => {
    let release = () => {}
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true, data: {} })
        }),
    )
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    const saving = await screen.findByRole('button', { name: 'Menyimpan...' })
    expect(saving.hasAttribute('disabled')).toBe(true)
    release()
  })

  /** A session that emptied out mid-edit must not put a name back on nobody. */
  it('skips the auth store when there is no signed-in user left', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    const { user, onClose } = renderForm()

    await user.clear(screen.getByLabelText('Nama Lengkap'))
    await user.type(screen.getByLabelText('Nama Lengkap'), 'Ari Wibowo')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useAuthStore.getState().user).toBeNull()
    expect(sentTo('/api/v1/me')).toEqual({ name: 'Ari Wibowo' })
  })
})

describe('validation', () => {
  it.each([
    ['Nama Lengkap', 'Nama lengkap wajib diisi'],
    ['Pengalaman (tahun)', 'Pengalaman harus berupa angka 0 atau lebih'],
  ])('refuses to save with %s empty', async (label, message) => {
    const { user, onClose } = renderForm()

    await user.clear(screen.getByLabelText(label))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', message)
    expect(apiFetch).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  /**
   * An empty skills list is read by the write path as "leave the skills
   * alone", so saving one would report success and change nothing.
   */
  it('refuses to save a profile with no skills left', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Hapus keahlian React' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Keahlian wajib diisi')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('clears the complaint once the draft is fixed', async () => {
    const { user } = renderForm()

    await user.clear(screen.getByLabelText('Nama Lengkap'))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))
    await screen.findByRole('alert')

    await user.type(screen.getByLabelText('Nama Lengkap'), 'Ari')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('skills', () => {
  it('adds a skill at the chosen proficiency', async () => {
    const { user } = renderForm()

    await user.type(screen.getByLabelText('Tambah Keahlian'), 'Go')
    await user.selectOptions(screen.getByLabelText('Tingkat Kemahiran'), 'expert')
    await user.click(screen.getByRole('button', { name: 'Tambah Keahlian' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().skills).toContainEqual({
      name: 'Go',
      proficiencyLevel: 'expert',
      isPrimary: false,
    })
  })

  it('ignores an add with nothing typed', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Tambah Keahlian' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().skills).toHaveLength(1)
  })

  it('changes the proficiency of a skill already listed', async () => {
    const { user } = renderForm()

    await user.selectOptions(screen.getByLabelText('Tingkat Kemahiran React'), 'beginner')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedSkills()[0].proficiencyLevel).toBe('beginner')
  })

  /** Editing one row of a list is where an off-by-one rewrites the wrong skill. */
  it('edits only the row it was asked to, not its neighbours', async () => {
    const { user } = renderForm({
      skills: [
        ...PROFILE.skills,
        { name: 'Go', category: 'backend', proficiencyLevel: 'beginner', isPrimary: false },
      ],
    })

    await user.selectOptions(screen.getByLabelText('Tingkat Kemahiran Go'), 'expert')
    await user.click(screen.getAllByRole('checkbox')[1])
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedSkills()).toEqual([
      { name: 'React', proficiencyLevel: 'advanced', isPrimary: true },
      { name: 'Go', proficiencyLevel: 'expert', isPrimary: true },
    ])
  })

  it('marks and unmarks a skill as primary', async () => {
    const { user } = renderForm()

    await user.click(screen.getAllByRole('checkbox')[0])
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedSkills()[0].isPrimary).toBe(false)
  })

  it('removes a skill the talent no longer claims', async () => {
    const { user } = renderForm({
      skills: [
        ...PROFILE.skills,
        { name: 'Go', category: 'backend', proficiencyLevel: 'beginner', isPrimary: false },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Hapus keahlian Go' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedSkills().map((s) => s.name)).toEqual(['React'])
  })
})

describe('portfolio links', () => {
  it('adds a platform and url pair', async () => {
    const { user } = renderForm()

    await user.type(screen.getByLabelText('Platform'), 'LinkedIn')
    await user.type(screen.getByLabelText('URL'), 'https://linkedin.com/in/ari')
    await user.click(screen.getByRole('button', { name: 'Tambah Tautan' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().portfolioLinks).toContainEqual({
      platform: 'LinkedIn',
      url: 'https://linkedin.com/in/ari',
    })
  })

  it.each([
    ['no platform', '', 'https://linkedin.com/in/ari'],
    ['no url', 'LinkedIn', ''],
  ])('ignores an add with %s', async (_label, platform, url) => {
    const { user } = renderForm()

    if (platform) await user.type(screen.getByLabelText('Platform'), platform)
    if (url) await user.type(screen.getByLabelText('URL'), url)
    await user.click(screen.getByRole('button', { name: 'Tambah Tautan' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().portfolioLinks).toHaveLength(1)
  })

  it('removes a link', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Hapus Tautan GitHub' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().portfolioLinks).toEqual([])
  })
})

describe('domain expertise', () => {
  it('adds a domain tag', async () => {
    const { user } = renderForm()

    await user.type(screen.getByLabelText('Tambah Bidang'), 'Logistik')
    await user.click(screen.getByRole('button', { name: 'Tambah Bidang' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().domainExpertise).toEqual(['Fintech', 'Logistik'])
  })

  it('ignores an add with nothing typed', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Tambah Bidang' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().domainExpertise).toEqual(['Fintech'])
  })

  it('removes a domain tag', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Hapus bidang Fintech' }))
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(savedProfile().domainExpertise).toEqual([])
  })
})

describe('completeness card', () => {
  it('reports a full profile with the percent sign and nothing outstanding', () => {
    render(<ProfileCompletenessCard profile={PROFILE} t={t} />)

    expect(screen.getByText('100%')).toBeDefined()
    expect(screen.getByText('Profil Anda sudah lengkap. Terima kasih!')).toBeDefined()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('names what is still missing without calling the profile unusable', () => {
    render(
      <ProfileCompletenessCard
        profile={{ ...PROFILE, cvFileUrl: null, domainExpertise: [] }}
        t={t}
      />,
    )

    expect(screen.getByText('71%')).toBeDefined()
    expect(screen.getByText('CV')).toBeDefined()
    expect(screen.getByText('Bidang keahlian')).toBeDefined()
    expect(
      screen.getByText(
        'Profil yang belum lengkap tetap bisa dipakai. Melengkapinya menaikkan peluang Anda dicocokkan dengan proyek.',
      ),
    ).toBeDefined()
  })

  it('reports an untouched profile at zero', () => {
    render(
      <ProfileCompletenessCard
        profile={{
          ...PROFILE,
          bio: '',
          yearsOfExperience: 0,
          educationUniversity: null,
          educationMajor: null,
          educationYear: null,
          cvFileUrl: null,
          portfolioLinks: [],
          domainExpertise: [],
          skills: [],
        }}
        t={t}
      />,
    )

    expect(screen.getByText('0%')).toBeDefined()
  })
})
