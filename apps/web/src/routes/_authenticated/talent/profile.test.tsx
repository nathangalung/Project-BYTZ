// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as profileRoute from './profile'

/**
 * The talent's own profile page.
 *
 * Two things here are the talent's livelihood rather than decoration. The
 * availability select feeds the matching algorithm directly, so a failed
 * update that looks like a success takes them out of consideration silently.
 * And an unverified talent cannot be matched at all, so the recovery path -
 * re-parse when storage still holds the CV, upload when it does not - is the
 * only way back; each of its failures has to name itself.
 *
 * Both fetch boundaries are stubbed. The mutations go through apiFetch; the
 * presigned PUT, parse-cv and reparse-cv are bare global fetch.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

type Profile = {
  id: string
  userId: string
  bio: string
  yearsOfExperience: number
  cvFileUrl: string | null
  portfolioLinks: { platform: string; url: string }[]
  availabilityStatus: string
  verificationStatus: string
  domainExpertise: string[]
  totalProjectsCompleted: number
  totalProjectsActive: number
  averageRating: number | null
  educationUniversity: string | null
  educationMajor: string | null
  educationYear: number | null
  skills: { name: string; category: string; proficiencyLevel: string; isPrimary: boolean }[]
}

const BASE: Profile = {
  id: 'tp-1',
  userId: 'u-9',
  bio: 'Builds Indonesian marketplaces.',
  yearsOfExperience: 4,
  cvFileUrl: 'cv/ari.pdf',
  portfolioLinks: [],
  availabilityStatus: 'available',
  verificationStatus: 'verified',
  domainExpertise: [],
  totalProjectsCompleted: 7,
  totalProjectsActive: 2,
  averageRating: 4.25,
  educationUniversity: 'ITB',
  educationMajor: 'Informatika',
  educationYear: 2019,
  skills: [{ name: 'React', category: 'frontend', proficiencyLevel: 'advanced', isPrimary: true }],
}

/** A promise that never settles, so the view stays in its loading state. */
const NEVER = () => new Promise(() => {})

const PRESIGNED = { url: 'https://storage.test/put/cv', key: 'cv/new.pdf', token: 'tok-1' }

/**
 * The routes the page reaches through bare fetch, answered per test.
 *
 * Routed by URL rather than sequenced with mockImplementationOnce, because the
 * ratings list in sections.tsx also goes out through bare fetch and would eat
 * the first queued answer before the button under test made its call.
 */
type FetchPlan = {
  reparse?: {
    ok: boolean
    body?: unknown
    throws?: boolean
    jsonThrows?: boolean
    /** Held open until the test releases it, to observe the in-flight state. */
    hold?: Promise<void>
  }
  put?: { ok: boolean }
  parse?: { ok: boolean }
}
let plan: FetchPlan = {}

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = String(input)
  if (url.includes('/reparse-cv')) {
    const r = plan.reparse ?? { ok: true }
    if (r.hold) await r.hold
    if (r.throws) throw new Error('network down')
    return {
      ok: r.ok,
      json: async () => {
        if (r.jsonThrows) throw new SyntaxError('not json')
        return r.body ?? {}
      },
    } as unknown as Response
  }
  if (url.includes('/parse-cv')) {
    return { ok: plan.parse?.ok ?? true, json: async () => ({}) } as unknown as Response
  }
  return { ok: plan.put?.ok ?? true, json: async () => ({}) } as unknown as Response
})

/** The page fans out to the profile query and the ratings list at once. */
function stubProfile(profile: Profile | 'loading' | 'error') {
  apiFetch.mockImplementation((url: string) => {
    if (String(url).includes('/talent-profiles/user/')) {
      if (profile === 'loading') return NEVER()
      if (profile === 'error') return Promise.reject(new Error('no profile'))
      return Promise.resolve({ success: true, data: profile })
    }
    if (String(url).includes('/upload/presigned-url')) return Promise.resolve(PRESIGNED)
    return Promise.resolve({ success: true, data: {} })
  })
}

function render() {
  return renderRoute(profileRoute, { path: '/talent/profile', destinations: ['/talent'] })
}
/** The JSON body of a recorded request, or a named failure if none matched. */
function sentBody(call: unknown[] | undefined): Record<string, unknown> {
  if (!call) throw new Error('no matching request was sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

function toasts() {
  return useToastStore.getState().toasts.map((t) => `${t.type}:${t.message}`)
}

beforeEach(() => {
  apiFetch.mockReset()
  fetchMock.mockClear()
  plan = {}
  vi.stubGlobal('fetch', fetchMock)
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({
    user: {
      id: 'u-9',
      email: 'ari@kerjacus.id',
      name: 'Ari Nugroho',
      role: 'talent',
      locale: 'id',
    },
    isAuthenticated: true,
    isLoading: false,
  })
  stubProfile(BASE)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The four-state contract: loading and error must not look like each other. */
describe('the four states of the profile', () => {
  it('withholds the not-found message while the request is in flight', async () => {
    stubProfile('loading')

    await render()

    expect(screen.queryByText('Profile Not Complete')).toBeNull()
  })

  it('says the profile is not complete when the request fails', async () => {
    stubProfile('error')

    await render()

    expect(await screen.findByText('Profile Not Complete')).toBeDefined()
  })

  it('renders the profile once it arrives', async () => {
    await render()

    expect(await screen.findByRole('heading', { name: 'Ari Nugroho' })).toBeDefined()
    expect(screen.getByText('Builds Indonesian marketplaces.')).toBeDefined()
  })

  /**
   * apiFetch calls logout() on any 401, so a token expiring under a mounted
   * page leaves this component with no user. It must not ask the server for
   * the profile of an empty id.
   */
  it('asks for nothing when the session has emptied out', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })

    await render()

    expect(await screen.findByText('Profile Not Complete')).toBeDefined()
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('/talent-profiles/user/'))).toBe(
      false,
    )
  })
})

describe('the identity block', () => {
  it('shows the uploaded avatar when there is one', async () => {
    useAuthStore.setState({
      user: {
        id: 'u-9',
        email: 'ari@kerjacus.id',
        name: 'Ari Nugroho',
        role: 'talent',
        locale: 'id',
        avatarUrl: 'https://cdn.test/ari.png',
      },
      isAuthenticated: true,
      isLoading: false,
    })

    const { container } = await render()

    await screen.findByRole('heading', { name: 'Ari Nugroho' })
    const img = container.querySelector('img[alt="Ari Nugroho"]') as HTMLImageElement
    expect(img.src).toBe('https://cdn.test/ari.png')
  })

  it('falls back to the initial of the name', async () => {
    await render()

    expect(await screen.findByText('A')).toBeDefined()
  })

  /**
   * The fallback initial is 'W', left over from the worker-to-talent rename.
   * Pinned as it stands rather than as it should read, so the rename is a test
   * change somebody has to make deliberately.
   */
  it('falls back to a stray W for an account with no name', async () => {
    useAuthStore.setState({
      user: { id: 'u-9', email: 'ari@kerjacus.id', name: '', role: 'talent', locale: 'id' },
      isAuthenticated: true,
      isLoading: false,
    })

    await render()

    expect(await screen.findByText('W')).toBeDefined()
  })

  it('leaves the bio out entirely rather than printing an empty paragraph', async () => {
    stubProfile({ ...BASE, bio: '' })

    const { container } = await render()

    await screen.findByRole('heading', { name: 'Ari Nugroho' })
    expect(container.textContent).not.toContain('Builds Indonesian marketplaces.')
  })

  it('marks a verified talent and states their years of experience', async () => {
    await render()

    expect(await screen.findByText('Verified')).toBeDefined()
    expect(screen.getByText(/4 years/i)).toBeDefined()
  })

  it('labels a status the palette does not know without crashing', async () => {
    stubProfile({ ...BASE, verificationStatus: 'under_appeal' })

    await render()

    expect(await screen.findByText('under_appeal')).toBeDefined()
  })
})

describe('the stats row', () => {
  it('counts completed and active projects', async () => {
    await render()

    await screen.findByRole('heading', { name: 'Ari Nugroho' })
    expect(screen.getByText('7')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  it('rounds the internal rating to one decimal', async () => {
    await render()

    expect(await screen.findByText('4.3')).toBeDefined()
  })

  /** A talent with no rating yet must not read as a zero-rated one. */
  it('shows a dash rather than a zero when there is no rating yet', async () => {
    stubProfile({ ...BASE, averageRating: null })

    await render()

    expect(await screen.findByText('-')).toBeDefined()
    expect(screen.queryByText('0.0')).toBeNull()
  })
})

describe('the recovery path for an unverified talent', () => {
  const UNVERIFIED = { ...BASE, verificationStatus: 'unverified' }

  it('offers a re-parse while storage still holds the CV', async () => {
    stubProfile(UNVERIFIED)

    await render()

    expect(await screen.findByRole('button', { name: /re-parse cv/i })).toBeDefined()
    expect(screen.queryByLabelText(/upload cv/i)).toBeNull()
  })

  it('offers an upload instead when there is no stored CV', async () => {
    stubProfile({ ...UNVERIFIED, cvFileUrl: null })

    await render()

    expect(await screen.findByLabelText(/upload cv/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /re-parse cv/i })).toBeNull()
  })

  it('offers neither to a verified talent', async () => {
    await render()

    await screen.findByRole('heading', { name: 'Ari Nugroho' })
    expect(screen.queryByRole('button', { name: /re-parse cv/i })).toBeNull()
    expect(screen.queryByLabelText(/upload cv/i)).toBeNull()
  })

  /** Two presses is two parse jobs billed against the same stored CV. */
  it('closes the re-parse button while the job runs', async () => {
    stubProfile(UNVERIFIED)
    let release: () => void = () => {}
    plan.reparse = {
      ok: true,
      hold: new Promise<void>((resolve) => {
        release = resolve
      }),
    }
    const user = userEvent.setup()
    await render()

    const button = await screen.findByRole('button', { name: /re-parse cv/i })
    await user.click(button)

    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    release()
    await waitFor(() => expect(toasts()).toContain('success:CV re-parsed'))
  })

  it('confirms a successful re-parse', async () => {
    stubProfile(UNVERIFIED)
    plan.reparse = { ok: true }
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /re-parse cv/i }))

    await waitFor(() => expect(toasts()).toContain('success:CV re-parsed'))
  })

  /**
   * Storage lost the file and the server dropped the key with it, so the page
   * has to refetch: the button the talent just pressed is the wrong control
   * from here on, and leaving it there is a loop with no exit.
   */
  it('names the missing file and swaps the button for the upload', async () => {
    stubProfile(UNVERIFIED)
    plan.reparse = { ok: false, body: { error: { code: 'CV_FILE_MISSING' } } }
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /re-parse cv/i }))

    await waitFor(() =>
      expect(toasts()).toContain('error:The CV is no longer in storage. Please upload it again.'),
    )
  })

  it('asks the talent to try again on any other refusal', async () => {
    stubProfile(UNVERIFIED)
    plan.reparse = { ok: false, body: { error: { code: 'AI_UNAVAILABLE' } } }
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /re-parse cv/i }))

    await waitFor(() => expect(toasts()).toContain('error:Could not re-parse. Please try again.'))
  })

  /** A gateway HTML error page is not JSON; the read must not become the error. */
  it('asks the talent to try again when the refusal carries no readable body', async () => {
    stubProfile(UNVERIFIED)
    plan.reparse = { ok: false, jsonThrows: true }
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /re-parse cv/i }))

    await waitFor(() => expect(toasts()).toContain('error:Could not re-parse. Please try again.'))
  })

  it('asks the talent to try again when the server cannot be reached', async () => {
    stubProfile(UNVERIFIED)
    plan.reparse = { ok: true, throws: true }
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /re-parse cv/i }))

    await waitFor(() => expect(toasts()).toContain('error:Could not re-parse. Please try again.'))
  })
})

describe('replacing a CV storage no longer holds', () => {
  const NO_CV = { ...BASE, verificationStatus: 'unverified', cvFileUrl: null }

  function file(name = 'cv.pdf', sizeBytes?: number): File {
    const f = new File(['%PDF-1.7'], name, { type: 'application/pdf' })
    if (sizeBytes !== undefined) Object.defineProperty(f, 'size', { value: sizeBytes })
    return f
  }

  async function upload(f: File) {
    stubProfile(NO_CV)
    const user = userEvent.setup()
    await render()
    await user.upload(await screen.findByLabelText(/upload cv/i), f)
    return user
  }

  it('refuses a CV over five megabytes before asking storage for anything', async () => {
    await upload(file('huge.pdf', 6 * 1024 * 1024))

    await waitFor(() => expect(toasts()).toContain('error:File size exceeds 5MB'))
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('presigned-url'))).toBe(false)
  })

  /** The control is a label wrapping the input; disabling it stops a re-pick. */
  it('closes the upload control while the replacement is in flight', async () => {
    stubProfile(NO_CV)
    let release: (v: unknown) => void = () => {}
    apiFetch.mockImplementation((url: string) =>
      String(url).includes('presigned-url')
        ? new Promise((resolve) => {
            release = resolve
          })
        : Promise.resolve({ success: true, data: NO_CV }),
    )
    const user = userEvent.setup()
    await render()

    const input = (await screen.findByLabelText(/upload cv/i)) as HTMLInputElement
    await user.upload(input, file())

    await waitFor(() => expect(input.disabled).toBe(true))
    release(PRESIGNED)
    await waitFor(() => expect(toasts()).toContain('success:CV re-parsed'))
  })

  it('confirms a replacement that stores and parses', async () => {
    await upload(file())

    await waitFor(() => expect(toasts()).toContain('success:CV re-parsed'))
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(PRESIGNED.url)
  })

  it('ignores a picker the talent opened and then cancelled', async () => {
    stubProfile(NO_CV)
    await render()

    fireEvent.change(await screen.findByLabelText(/upload cv/i), { target: { files: [] } })

    expect(toasts()).toEqual([])
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('presigned-url'))).toBe(false)
  })

  it('reports a failure when storage will not issue a URL', async () => {
    stubProfile(NO_CV)
    apiFetch.mockImplementation((url: string) =>
      String(url).includes('presigned-url')
        ? Promise.reject(new Error('quota'))
        : Promise.resolve({ success: true, data: NO_CV }),
    )
    const user = userEvent.setup()
    await render()

    await user.upload(await screen.findByLabelText(/upload cv/i), file())

    await waitFor(() => expect(toasts()).toContain('error:Failed to upload CV'))
  })

  it('reports a failure when the file will not store', async () => {
    plan.put = { ok: false }

    await upload(file())

    await waitFor(() => expect(toasts()).toContain('error:Failed to upload CV'))
  })

  it('reports a failure when the stored file will not parse', async () => {
    plan.parse = { ok: false }

    await upload(file())

    await waitFor(() => expect(toasts()).toContain('error:Failed to upload CV'))
  })

  it('sends the storage key and the extension on to the parser', async () => {
    await upload(file('resume.pdf'))

    await waitFor(() => expect(toasts()).toContain('success:CV re-parsed'))
    expect(sentBody(fetchMock.mock.calls.find((c) => String(c[0]).includes('/parse-cv')))).toEqual({
      key: PRESIGNED.key,
      token: PRESIGNED.token,
      fileType: 'pdf',
    })
  })
})

/**
 * Availability is a matching input, so a silent failure costs work.
 *
 * DEFECT, and the reason this block queries by role rather than by label: the
 * word "Availability" sits in a plain span beside the select, with no htmlFor,
 * no id and no aria-label. The control has no accessible name, so a screen
 * reader announces an unlabelled combobox. It happens to be the only select on
 * the page, which is the only thing that makes the role query unambiguous.
 */
describe('changing availability', () => {
  const availability = () => screen.findByRole('combobox')

  it('opens on the status the server holds', async () => {
    stubProfile({ ...BASE, availabilityStatus: 'busy' })

    await render()

    expect(((await availability()) as HTMLSelectElement).value).toBe('busy')
  })

  it('sends the new status against this profile and confirms it', async () => {
    const user = userEvent.setup()
    await render()

    await user.selectOptions(await availability(), 'unavailable')

    await waitFor(() => expect(toasts()).toContain('success:Availability updated'))
    const call = apiFetch.mock.calls.find((c) => String(c[0]).includes('/availability'))
    expect(String(call?.[0])).toContain('/talent-profiles/tp-1/availability')
    expect(sentBody(call)).toEqual({ availability: 'unavailable' })
  })

  it('says so when the change does not take', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (String(url).includes('/availability')) return Promise.reject(new Error('conflict'))
      if (String(url).includes('/talent-profiles/user/'))
        return Promise.resolve({ success: true, data: BASE })
      return Promise.resolve({ success: true, data: {} })
    })
    const user = userEvent.setup()
    await render()

    await user.selectOptions(await availability(), 'busy')

    await waitFor(() =>
      expect(toasts()).toContain('error:Could not update availability. Please try again.'),
    )
  })
})
