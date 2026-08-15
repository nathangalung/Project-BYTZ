// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as registerRoute from './register'

/**
 * The three-step flow that turns a signed-up account into a talent profile.
 *
 * This is where a talent's CV, education, employment history and portfolio
 * links enter the platform, so the branches that matter are the refusals: an
 * oversize upload, a submit missing a field the form marks required, and every
 * way the parse can fail without stranding the person mid-flow.
 *
 * Two fetch boundaries, and a test that stubs one and not the other reaches
 * the network. The mutations go through apiFetch in @/lib/api; the presigned
 * PUT and the parse-cv POST are bare global fetch. Both are stubbed below.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PRESIGNED = { url: 'https://storage.test/put/cv', key: 'cv/abc.pdf', token: 'tok-1' }

/** Whatever the parse endpoint should answer, per test. */
let parseReply: { ok: boolean; body: unknown } | Error = {
  ok: true,
  body: { success: true, data: { parsed_data: {} } },
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = String(input)
  if (url.includes('/parse-cv')) {
    const reply = parseReply
    if (reply instanceof Error) throw reply
    return { ok: reply.ok, json: async () => reply.body } as unknown as Response
  }
  // The presigned PUT. The component ignores the response entirely.
  return { ok: true, json: async () => ({}) } as unknown as Response
})

function cvFile(name = 'cv.pdf', sizeBytes?: number): File {
  const file = new File(['%PDF-1.7 curriculum vitae'], name, { type: 'application/pdf' })
  if (sizeBytes !== undefined) Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

function render() {
  return renderRoute(registerRoute, {
    path: '/talent/register',
    destinations: ['/talent', '/dashboard'],
  })
}
/** The JSON body of a recorded request, or a named failure if none matched. */
function sentBody(call: unknown[] | undefined): Record<string, unknown> {
  if (!call) throw new Error('no matching request was sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

/** The dropzone hides its input, so it is reached by type rather than by role. */
function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type=file]') as HTMLInputElement
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue(PRESIGNED)
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  parseReply = { ok: true, body: { success: true, data: { parsed_data: {} } } }
  localStorage.clear()
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the step indicator', () => {
  it('opens on the first of three steps', async () => {
    await render()

    expect(screen.getByText('Step 1 of 3')).toBeDefined()
  })
})

/**
 * The session can empty out under a mounted page: apiFetch calls logout() on
 * any 401, so a token expiring mid-form leaves this component rendering with
 * no user. It has to stay usable rather than throw on user.name.
 */
describe('a session that has emptied out', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
  })

  it('opens the form with a blank name rather than crashing', async () => {
    await render()

    expect(screen.getByText('Step 1 of 3')).toBeDefined()
  })

  it('submits without claiming the profile for an account it cannot name', async () => {
    const user = userEvent.setup()
    const { container } = await render()
    await chooseCv(user, container)
    await user.click(screen.getByRole('button', { name: /continue to verify/i }))
    await screen.findByText('Step 2 of 3')
    await user.type(screen.getByLabelText(/full name/i), 'Ari Nugroho')
    await completeVerification(user)

    await user.click(screen.getByRole('button', { name: /data is correct/i }))

    await screen.findByText('Profile Created Successfully')
    expect(localStorage.getItem('kerjacus-profile-complete')).toBeNull()
  })
})

describe('choosing a CV', () => {
  it('withholds the continue button until a file is chosen', async () => {
    const { container } = await render()

    const button = screen.getByRole('button', { name: /continue to verify/i })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(fileInput(container).value).toBe('')
  })

  it('shows the chosen file and its size, and opens the way forward', async () => {
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(fileInput(container), cvFile('ari-cv.pdf', 1_572_864))

    expect(screen.getAllByText('ari-cv.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText('1.50 MB')).toBeDefined()
    expect(
      screen.getByRole('button', { name: /continue to verify/i }).hasAttribute('disabled'),
    ).toBe(false)
  })

  /**
   * The cap is the platform's, not the browser's: a 6MB CV is accepted by the
   * file picker and has to be refused here or it fails later against storage.
   */
  it('refuses a CV over five megabytes and keeps the way forward shut', async () => {
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(fileInput(container), cvFile('huge.pdf', 6 * 1024 * 1024))

    expect(await screen.findByText('File size exceeds 5MB')).toBeDefined()
    expect(
      screen.getByRole('button', { name: /continue to verify/i }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps the last good file when an oversize one is chosen after it', async () => {
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(fileInput(container), cvFile('good.pdf', 1024))
    await user.upload(fileInput(container), cvFile('huge.pdf', 6 * 1024 * 1024))

    expect(await screen.findByText('File size exceeds 5MB')).toBeDefined()
    expect(screen.getAllByText('good.pdf').length).toBeGreaterThan(0)
  })

  /**
   * user-event v14 has no drag-and-drop API, so the drop is dispatched
   * directly. The dropzone is advertised to the user as droppable, which makes
   * this a path worth executing rather than one to skip on tooling grounds.
   */
  it('accepts a file dropped onto the zone', async () => {
    const { container } = await render()
    const zone = screen.getByRole('button', { name: /drag your cv here/i })

    fireEvent.dragOver(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [cvFile('dropped.pdf', 2048)] } })

    expect((await screen.findAllByText('dropped.pdf')).length).toBeGreaterThan(0)
    expect(fileInput(container).value).toBe('')
  })

  it('ignores a picker the talent opened and then cancelled', async () => {
    const { container } = await render()

    fireEvent.change(fileInput(container), { target: { files: [] } })

    expect(
      screen.getByRole('button', { name: /continue to verify/i }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('ignores a drop carrying no file', async () => {
    await render()
    const zone = screen.getByRole('button', { name: /drag your cv here/i })

    fireEvent.drop(zone, { dataTransfer: { files: [] } })

    expect(
      screen.getByRole('button', { name: /continue to verify/i }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByText(/drag your cv here/i)).toBeDefined()
  })
})

/** Everything below needs a file already chosen. */
async function chooseCv(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.upload(fileInput(container), cvFile())
}

async function uploadAndParse() {
  const user = userEvent.setup()
  const rendered = await render()
  await chooseCv(user, rendered.container)
  await user.click(screen.getByRole('button', { name: /continue to verify/i }))
  return { user, ...rendered }
}

describe('uploading and parsing the CV', () => {
  it('stores the file, then moves on to verification', async () => {
    await uploadAndParse()

    expect(await screen.findByText('Step 2 of 3')).toBeDefined()
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(PRESIGNED.url)
  })

  /**
   * Upload plus parse is the longest wait in the flow, so the button has to
   * say it is working and refuse a second press. Two presses is two uploads
   * and two parse jobs billed against the same CV.
   */
  it('says it is working and refuses a second press while it runs', async () => {
    let release: (v: unknown) => void = () => {}
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const user = userEvent.setup()
    const { container } = await render()
    await chooseCv(user, container)

    await user.click(screen.getByRole('button', { name: /continue to verify/i }))

    const working = await screen.findByRole('button', { name: /processing cv/i })
    expect(working.hasAttribute('disabled')).toBe(true)
    release(PRESIGNED)
    expect(await screen.findByText('Step 2 of 3')).toBeDefined()
  })

  it('opens the file picker from the dropzone itself', async () => {
    const user = userEvent.setup()
    const { container } = await render()
    const picker = vi.spyOn(fileInput(container), 'click')

    await user.click(screen.getByRole('button', { name: /drag your cv here/i }))

    expect(picker).toHaveBeenCalledTimes(1)
  })

  it('moves on with the form untouched when the parser answers with nothing', async () => {
    parseReply = { ok: true, body: {} }

    await uploadAndParse()

    expect(await screen.findByText('Step 2 of 3')).toBeDefined()
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('Ari Nugroho')
    expect((screen.getByLabelText(/detected skills/i) as HTMLInputElement).value).toBe('')
  })

  it('sends the storage key and token on to the parser', async () => {
    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    const body = sentBody(fetchMock.mock.calls.find((c) => String(c[0]).includes('/parse-cv')))
    expect(body).toEqual({ key: PRESIGNED.key, token: PRESIGNED.token, fileType: 'pdf' })
  })

  it('fills the form from what the parser read', async () => {
    parseReply = {
      ok: true,
      body: {
        success: true,
        data: {
          parsed_data: {
            name: 'Ari Nugroho Putra',
            skills: ['React', 'TypeScript'],
            education: [{ universitas: 'ITB', jurusan: 'Informatika' }],
            experience: [{ posisi: 'Frontend Engineer' }, { posisi: 'Intern' }],
            projects: [{ url: 'https://github.com/ari/app' }, { url: '' }],
          },
        },
      },
    }

    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe(
      'Ari Nugroho Putra',
    )
    expect((screen.getByLabelText(/detected skills/i) as HTMLInputElement).value).toBe(
      'React, TypeScript',
    )
    expect((screen.getByLabelText('University') as HTMLInputElement).value).toBe('ITB')
    expect((screen.getByLabelText('Major') as HTMLInputElement).value).toBe('Informatika')
    expect((screen.getByLabelText(/role \/ position/i) as HTMLInputElement).value).toBe(
      'Frontend Engineer',
    )
    expect((screen.getByPlaceholderText('https://github.com/...') as HTMLInputElement).value).toBe(
      'https://github.com/ari/app',
    )
  })

  /** The parser answers in either language depending on the CV it read. */
  it('reads the English-keyed shape of the same answer', async () => {
    parseReply = {
      ok: true,
      body: {
        parsed_data: {
          education: [{ university: 'Universitas Indonesia', major: 'Computer Science' }],
          experience: [{ position: 'Backend Engineer' }],
        },
      },
    }

    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    expect((screen.getByLabelText('University') as HTMLInputElement).value).toBe(
      'Universitas Indonesia',
    )
    expect((screen.getByLabelText('Major') as HTMLInputElement).value).toBe('Computer Science')
    expect((screen.getByLabelText(/role \/ position/i) as HTMLInputElement).value).toBe(
      'Backend Engineer',
    )
  })

  it('leaves education blank when the parser named neither key', async () => {
    parseReply = {
      ok: true,
      body: { parsed_data: { education: [{ tahun_lulus: 2021 }], experience: [{}] } },
    }

    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    expect((screen.getByLabelText('University') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/role \/ position/i) as HTMLInputElement).value).toBe('')
  })

  /**
   * The band, not the option's wording: this value is what maps to the number
   * of years sent to the server, so it is the part a copy edit must not move.
   * The visible range is checked as a substring for the same reason.
   */
  it.each([
    [1, '0-1'],
    [2, '1-3'],
    [4, '3-5'],
    [6, '5+'],
  ])('buckets %i jobs on the CV into the matching experience band', async (count, band) => {
    parseReply = {
      ok: true,
      body: {
        parsed_data: {
          experience: Array.from({ length: count }, (_, i) => ({ posisi: `Role ${i}` })),
        },
      },
    }

    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    const select = screen.getByLabelText('Experience') as HTMLSelectElement
    expect(select.value).toBe(band)
    expect(select.selectedOptions[0].textContent).toContain(`(${band} years)`)
  })

  it('keeps at most three portfolio links', async () => {
    parseReply = {
      ok: true,
      body: {
        parsed_data: {
          projects: [
            { url: 'https://a.test' },
            { url: 'https://b.test' },
            { url: 'https://c.test' },
            { url: 'https://d.test' },
          ],
        },
      },
    }

    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    const urls = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=url]')).map(
      (i) => i.value,
    )
    expect(urls).toEqual(['https://a.test', 'https://b.test', 'https://c.test'])
  })

  it('leaves the links empty when no project carried a url', async () => {
    parseReply = { ok: true, body: { parsed_data: { projects: [{ nama: 'Untitled' }] } } }

    await uploadAndParse()

    await screen.findByText('Step 2 of 3')
    const urls = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=url]')).map(
      (i) => i.value,
    )
    expect(urls).toEqual(['', '', ''])
  })

  /**
   * Parsing is a convenience. A parser that is down must not cost the talent
   * the upload they already paid for in time, so the flow continues either way.
   */
  it('moves on to verification when the parser refuses the file', async () => {
    parseReply = { ok: false, body: { error: { code: 'AI_PARSE_FAILED' } } }

    await uploadAndParse()

    expect(await screen.findByText('Step 2 of 3')).toBeDefined()
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('Ari Nugroho')
  })

  it('moves on to verification when the parser cannot be reached at all', async () => {
    parseReply = new Error('network down')

    await uploadAndParse()

    expect(await screen.findByText('Step 2 of 3')).toBeDefined()
  })

  /** Storage failing is different: there is no CV, so there is nothing to fix. */
  it('stays on the upload step and says why when storage refuses the file', async () => {
    apiFetch.mockRejectedValue(new Error('Bucket unavailable'))

    await uploadAndParse()

    expect(await screen.findByText('Bucket unavailable')).toBeDefined()
    expect(screen.getByText('Step 1 of 3')).toBeDefined()
  })

  it('falls back to a generic message when storage fails without one', async () => {
    apiFetch.mockRejectedValue('nope')

    await uploadAndParse()

    expect(await screen.findByText('Failed to upload CV')).toBeDefined()
  })
})

/** Fill the four fields the form marks required, then submit. */
async function completeVerification(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { bio?: string } = {},
) {
  await user.type(screen.getByLabelText(/role \/ position/i), 'Frontend Engineer')
  await user.selectOptions(screen.getByLabelText('Experience'), '1-3')
  await user.type(screen.getByLabelText(/detected skills/i), 'React, TypeScript')
  await user.type(screen.getByLabelText('Short Bio'), overrides.bio ?? 'Builds web apps.')
}

describe('the verification step', () => {
  it('refuses a submit with no name', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')

    await user.clear(screen.getByLabelText(/full name/i))
    await completeVerification(user)
    await user.click(screen.getByRole('button', { name: /data is correct/i }))

    expect(await screen.findByText('Full name is required')).toBeDefined()
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('/talent-profiles'))).toBe(false)
  })

  it('refuses a submit with no role', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')

    await user.selectOptions(screen.getByLabelText('Experience'), '1-3')
    await user.type(screen.getByLabelText(/detected skills/i), 'React')
    await user.type(screen.getByLabelText('Short Bio'), 'Builds web apps.')
    await user.click(screen.getByRole('button', { name: /data is correct/i }))

    expect(await screen.findByText('Role is required')).toBeDefined()
  })

  it('refuses a submit with no experience band', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')

    await user.type(screen.getByLabelText(/role \/ position/i), 'Frontend Engineer')
    await user.type(screen.getByLabelText(/detected skills/i), 'React')
    await user.type(screen.getByLabelText('Short Bio'), 'Builds web apps.')
    await user.click(screen.getByRole('button', { name: /data is correct/i }))

    expect(await screen.findByText('Experience is required')).toBeDefined()
  })

  /**
   * DEFECT. Every field the form marks required with an asterisk is filled,
   * and the submit button is still disabled, because its own condition also
   * requires the bio - which carries no asterisk and no error message. The
   * talent is left pressing a dead button with nothing on screen naming the
   * field that is missing.
   */
  it('leaves the submit button dead when only the un-asterisked bio is empty', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')

    await user.type(screen.getByLabelText(/role \/ position/i), 'Frontend Engineer')
    await user.selectOptions(screen.getByLabelText('Experience'), '1-3')
    await user.type(screen.getByLabelText(/detected skills/i), 'React, TypeScript')

    const submit = screen.getByRole('button', { name: /data is correct/i })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/required/i)).toBeNull()
  })

  it('opens the submit button once the bio is filled too', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')

    await completeVerification(user)

    expect(screen.getByRole('button', { name: /data is correct/i }).hasAttribute('disabled')).toBe(
      false,
    )
  })

  it('returns to the upload step without losing the chosen file', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')

    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(await screen.findByText('Step 1 of 3')).toBeDefined()
    expect(screen.getAllByText('cv.pdf').length).toBeGreaterThan(0)
  })
})

describe('submitting the profile', () => {
  async function submit(links: string[] = []) {
    const { user, router } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')
    await completeVerification(user)
    await user.type(screen.getByLabelText('Location'), 'Bandung')
    await user.type(screen.getByLabelText('University'), 'ITB')
    await user.type(screen.getByLabelText('Major'), 'Informatika')
    const urlInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=url]'))
    for (const [i, link] of links.entries()) {
      if (link) await user.type(urlInputs[i], link)
    }
    await user.click(screen.getByRole('button', { name: /data is correct/i }))
    return { user, router }
  }

  function profileBody(): Record<string, unknown> {
    return sentBody(apiFetch.mock.calls.find((c) => String(c[0]).includes('/talent-profiles')))
  }

  it('confirms the profile is live and offers the dashboard', async () => {
    await submit()

    expect(await screen.findByText('Profile Created Successfully')).toBeDefined()
    expect(screen.getByRole('button', { name: /go to talent dashboard/i })).toBeDefined()
  })

  it('sends the storage key, the band as a number of years and the split skills', async () => {
    await submit()

    await screen.findByText('Profile Created Successfully')
    const body = profileBody()
    expect(body.cvFileUrl).toBe(PRESIGNED.key)
    expect(body.yearsOfExperience).toBe(2)
    expect(body.location).toBe('Bandung')
    expect(body.skills).toEqual([
      { name: 'React', proficiencyLevel: 'intermediate', isPrimary: false },
      { name: 'TypeScript', proficiencyLevel: 'intermediate', isPrimary: false },
    ])
  })

  it('names each portfolio link by the site it points at', async () => {
    await submit(['https://github.com/ari', 'https://linkedin.com/in/ari', 'https://ari.dev/work'])

    await screen.findByText('Profile Created Successfully')
    expect(profileBody().portfolioLinks).toEqual([
      { platform: 'GitHub', url: 'https://github.com/ari' },
      { platform: 'LinkedIn', url: 'https://linkedin.com/in/ari' },
      { platform: 'Website', url: 'https://ari.dev/work' },
    ])
  })

  it('names a dribbble and a behance link too', async () => {
    await submit(['https://dribbble.com/ari', 'https://behance.net/ari'])

    await screen.findByText('Profile Created Successfully')
    expect(profileBody().portfolioLinks).toEqual([
      { platform: 'Dribbble', url: 'https://dribbble.com/ari' },
      { platform: 'Behance', url: 'https://behance.net/ari' },
    ])
  })

  /**
   * The optional fields go as undefined rather than as empty strings, so the
   * server stores a null it can distinguish from "the talent said nothing".
   */
  it('omits the optional fields the talent left blank', async () => {
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')
    await completeVerification(user)

    await user.click(screen.getByRole('button', { name: /data is correct/i }))

    await screen.findByText('Profile Created Successfully')
    const body = profileBody()
    expect(body.location).toBeUndefined()
    expect(body.educationUniversity).toBeUndefined()
    expect(body.educationMajor).toBeUndefined()
    expect(body.portfolioLinks).toEqual([])
  })

  /** Two presses is two profile rows, so the button closes while it runs. */
  it('says it is submitting and refuses a second press', async () => {
    let release: (v: unknown) => void = () => {}
    const { user } = await uploadAndParse()
    await screen.findByText('Step 2 of 3')
    await completeVerification(user)
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    await user.click(screen.getByRole('button', { name: /data is correct/i }))

    const working = await screen.findByRole('button', { name: /submitting/i })
    expect(working.hasAttribute('disabled')).toBe(true)
    release({ id: 'tp-1' })
    expect(await screen.findByText('Profile Created Successfully')).toBeDefined()
  })

  /** The guard the talent dashboard reads before it stops redirecting here. */
  it('records that this account has finished its profile', async () => {
    await submit()

    await screen.findByText('Profile Created Successfully')
    expect(localStorage.getItem('kerjacus-profile-complete')).toBe('u-9')
  })

  it('shows the reason and stays put when the profile is rejected', async () => {
    apiFetch.mockImplementation((url: string) =>
      String(url).includes('/talent-profiles')
        ? Promise.reject(new Error('Skill not in taxonomy'))
        : Promise.resolve(PRESIGNED),
    )

    await submit()

    expect(await screen.findByText('Skill not in taxonomy')).toBeDefined()
    expect(screen.getByText('Step 2 of 3')).toBeDefined()
    expect(localStorage.getItem('kerjacus-profile-complete')).toBeNull()
  })

  it('falls back to a generic message when the rejection carries none', async () => {
    apiFetch.mockImplementation((url: string) =>
      String(url).includes('/talent-profiles')
        ? Promise.reject('nope')
        : Promise.resolve(PRESIGNED),
    )

    await submit()

    expect(await screen.findByText('Failed to submit profile')).toBeDefined()
  })

  it('sends the talent on to their dashboard from the success step', async () => {
    const { user, router } = await submit()
    await screen.findByText('Profile Created Successfully')

    await user.click(screen.getByRole('button', { name: /go to talent dashboard/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/talent'))
  })
})
