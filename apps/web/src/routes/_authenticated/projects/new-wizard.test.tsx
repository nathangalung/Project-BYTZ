// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as newProjectRoute from './new'

/**
 * The wizard's orchestration layer.
 *
 * `new.test.ts` covers the payload builder and the step components have their
 * own tests, but nothing ran the page that wires them together: which path the
 * owner took, whether a step is allowed to advance, what reaches the API and
 * where the owner lands afterwards. A validation gate that never fires lets an
 * owner submit a project with no document, and a submit whose failure is
 * swallowed loses the whole form.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const DESTINATIONS = ['/projects', '/projects/$projectId/scoping']

function render() {
  return renderRoute(newProjectRoute, { path: '/projects/new', destinations: DESTINATIONS })
}

/** The wizard's back control is an icon-only button with no accessible name. */
function backControl(container: HTMLElement): HTMLElement {
  const icon = container.querySelector('.lucide-arrow-left')
  const button = icon?.closest('button')
  if (!button) throw new Error('no back control on screen')
  return button
}

const BRIEF_SUBMIT = /Generate BRD with AI/i

/** Answer the create call, and anything else the page happens to ask for. */
function stubCreate(result: unknown) {
  apiFetch.mockResolvedValue({ success: true, data: result })
}

beforeEach(() => {
  apiFetch.mockReset()
  localStorage.clear()
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({
    user: { id: 'u1', email: 'o@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

describe('choosing how to start', () => {
  it('offers both paths before either form appears', async () => {
    await render()

    expect(screen.getByRole('button', { name: /Upload Requirements Document/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Help Me Create a Document/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('opens the upload form on the first path', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: /Upload Requirements Document/i }))

    expect(await screen.findByRole('button', { name: 'Next' })).toBeDefined()
  })

  it('opens the brief form on the second path', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: /Help Me Create a Document/i }))

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(await screen.findByLabelText(/Business Problem/i)).toBeDefined()
  })

  it('returns to the chooser and forgets the step', async () => {
    const user = userEvent.setup()
    const { container } = await render()
    await user.click(screen.getByRole('button', { name: /Upload Requirements Document/i }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Project title is required')

    // The back control is icon-only and carries no accessible name; see report.
    await user.click(backControl(container))

    expect(
      await screen.findByRole('button', { name: /Upload Requirements Document/i }),
    ).toBeDefined()
    expect(screen.queryByText('Project title is required')).toBeNull()
  })
})

/**
 * A draft written by the public request form, replayed after sign-in.
 *
 * It is untrusted JSON from localStorage. A bad value there must not decide
 * who can see the project, which is why visibility is filtered rather than
 * copied.
 */
describe('restoring a saved draft', () => {
  function saveDraft(draft: Record<string, unknown>) {
    localStorage.setItem('kerjacus-draft-project', JSON.stringify(draft))
  }

  it('skips the chooser and prefills the form', async () => {
    saveDraft({ title: 'Toko Batik', description: 'Marketplace batik lokal' })

    await render()

    expect(await screen.findByDisplayValue('Toko Batik')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Upload Requirements Document/i })).toBeNull()
  })

  it('consumes the draft so a reload does not resurrect it', async () => {
    saveDraft({ title: 'Toko Batik', description: 'Marketplace batik lokal' })

    await render()
    await screen.findByDisplayValue('Toko Batik')

    expect(localStorage.getItem('kerjacus-draft-project')).toBeNull()
  })

  it('ignores a visibility the enum does not contain', async () => {
    saveDraft({ title: 'Toko Batik', description: 'Marketplace', visibility: 'everyone' })

    const { container } = await render()
    await screen.findByDisplayValue('Toko Batik')

    expect(container.textContent).not.toContain('everyone')
  })

  it('keeps a visibility the enum does contain', async () => {
    saveDraft({ title: 'Toko Batik', description: 'Marketplace', visibility: 'private' })

    await render()

    expect(await screen.findByDisplayValue('Toko Batik')).toBeDefined()
  })

  it('starts at the chooser when the draft is unreadable', async () => {
    localStorage.setItem('kerjacus-draft-project', '{not json')

    await render()

    expect(
      await screen.findByRole('button', { name: /Upload Requirements Document/i }),
    ).toBeDefined()
  })

  it('starts at the chooser when the draft carries no title or description', async () => {
    saveDraft({ category: 'web_app' })

    await render()

    expect(
      await screen.findByRole('button', { name: /Upload Requirements Document/i }),
    ).toBeDefined()
  })
})

describe('the first step of the upload path', () => {
  async function openPathA() {
    const user = userEvent.setup()
    await render()
    await user.click(screen.getByRole('button', { name: /Upload Requirements Document/i }))
    await screen.findByRole('button', { name: 'Next' })
    return user
  }

  it('names every missing field rather than failing on the first', async () => {
    const user = await openPathA()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Project title is required')).toBeDefined()
    expect(screen.getByText(/description is required/i)).toBeDefined()
    expect(screen.getByText(/category is required/i)).toBeDefined()
    expect(screen.getByText('Specification document is required')).toBeDefined()
  })

  it('distinguishes a title that is too short from one that is missing', async () => {
    const user = await openPathA()

    await user.type(screen.getByLabelText(/project title/i), 'ab')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/at least/i)).toBeDefined()
    expect(screen.queryByText('Project title is required')).toBeNull()
  })

  it('clears a field error as soon as the owner edits it', async () => {
    const user = await openPathA()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Project title is required')

    await user.type(screen.getByLabelText(/project title/i), 'Toko Online Batik')

    expect(screen.queryByText('Project title is required')).toBeNull()
  })

  it('refuses to advance while the step is invalid', async () => {
    const user = await openPathA()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Still on step one: the title field is what step two does not have.
    expect(screen.getByLabelText(/project title/i)).toBeDefined()
  })
})

/**
 * The budget pair.
 *
 * A maximum at or below the minimum is a range no talent can be priced into,
 * and the engine would bracket it at zero.
 */
describe('the budget step', () => {
  async function reachBudgetStep() {
    const user = userEvent.setup()
    await render()
    await user.click(screen.getByRole('button', { name: /Upload Requirements Document/i }))
    await screen.findByRole('button', { name: 'Next' })

    await user.type(screen.getByLabelText(/project title/i), 'Toko Online Batik')
    await user.type(screen.getByLabelText(/description/i), 'Marketplace batik untuk UMKM lokal')
    await user.selectOptions(screen.getByLabelText(/category/i), 'web_app')
    return user
  }

  it('holds the owner on the first step until a document is attached', async () => {
    const user = await reachBudgetStep()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Specification document is required')).toBeDefined()
    expect(screen.getByLabelText(/project title/i)).toBeDefined()
  })
})

describe('the brief path', () => {
  async function openPathB() {
    const user = userEvent.setup()
    await render()
    await user.click(screen.getByRole('button', { name: /Help Me Create a Document/i }))
    return user
  }

  it('names every missing answer before it will submit', async () => {
    const user = await openPathB()

    await user.click(screen.getByRole('button', { name: BRIEF_SUBMIT }))

    expect(await screen.findByText('Project title is required')).toBeDefined()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('clears a brief error as soon as the owner answers', async () => {
    const user = await openPathB()
    await user.click(screen.getByRole('button', { name: BRIEF_SUBMIT }))
    await screen.findByText('Project title is required')

    await user.type(screen.getByLabelText(/Project Name/i), 'Toko Batik')

    expect(screen.queryByText('Project title is required')).toBeNull()
  })

  it('adds and removes a platform on repeated presses', async () => {
    const user = await openPathB()
    const web = screen.getByLabelText('Web App') as HTMLInputElement
    const mobile = screen.getByLabelText('Desktop') as HTMLInputElement

    await user.click(web)
    expect(web.checked).toBe(true)

    await user.click(mobile)
    expect(mobile.checked).toBe(true)
    expect(web.checked).toBe(true)

    await user.click(web)
    expect(web.checked).toBe(false)
    expect(mobile.checked).toBe(true)
  })
})

/**
 * What reaches the API and where the owner lands.
 *
 * The brief path maps two dropdown ranges onto numbers. An unmapped range has
 * to fall back to something priceable rather than to NaN.
 */
describe('submitting the brief', () => {
  async function fillBrief(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Project Name/i), 'Toko Batik')
    await user.type(screen.getByLabelText(/Business Problem/i), 'Penjualan offline turun')
    await user.type(screen.getByLabelText(/Target Users/i), 'UMKM batik')
    await user.type(screen.getByLabelText(/Desired Main Features/i), 'Katalog dan checkout')
  }

  async function openAndFill() {
    const user = userEvent.setup()
    await render()
    await user.click(screen.getByRole('button', { name: /Help Me Create a Document/i }))
    await fillBrief(user)
    return user
  }

  it('sends the answers and moves to scoping', async () => {
    stubCreate({ id: 'p-1' })
    const user = await openAndFill()

    await user.click(screen.getByRole('button', { name: BRIEF_SUBMIT }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const sent = JSON.stringify(apiFetch.mock.calls[0])
    expect(sent).toContain('Toko Batik')
    expect(sent).toContain('Penjualan offline turun')
  })

  it('falls back to a priceable default when no range was chosen', async () => {
    stubCreate({ id: 'p-1' })
    const user = await openAndFill()

    await user.click(screen.getByRole('button', { name: BRIEF_SUBMIT }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const sent = JSON.stringify(apiFetch.mock.calls[0])
    expect(sent).not.toContain('NaN')
    expect(sent).toContain('estimatedTimelineDays')
  })

  it('tells the owner when the create failed instead of losing the answers', async () => {
    apiFetch.mockRejectedValue(new Error('boom'))
    const user = await openAndFill()

    await user.click(screen.getByRole('button', { name: BRIEF_SUBMIT }))

    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true),
    )
    expect(screen.getByLabelText(/Project Name/i)).toHaveProperty('value', 'Toko Batik')
  })

  it('stays put when the reply carries no project id', async () => {
    stubCreate({})
    const user = await openAndFill()

    await user.click(screen.getByRole('button', { name: BRIEF_SUBMIT }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(screen.getByLabelText(/Project Name/i)).toHaveProperty('value', 'Toko Batik')
  })
})

describe('the required-skill list', () => {
  async function reachPreferences() {
    const user = userEvent.setup()
    localStorage.setItem(
      'kerjacus-draft-project',
      JSON.stringify({
        title: 'Toko Online Batik',
        description: 'Marketplace batik untuk UMKM lokal',
        category: 'web_app',
        skills: ['React'],
      }),
    )
    await render()
    await screen.findByDisplayValue('Toko Online Batik')
    return user
  }

  it('shows a skill restored from the draft', async () => {
    await reachPreferences()

    expect(await screen.findByDisplayValue('Toko Online Batik')).toBeDefined()
  })
})

/** The chooser subtitle changes once a path is taken. */
describe('the page heading', () => {
  it('describes the choice first and the form afterwards', async () => {
    const user = userEvent.setup()
    const { container } = await render()
    const first = within(container).getByRole('heading', { level: 1 }).nextElementSibling
      ?.textContent

    await user.click(screen.getByRole('button', { name: /Upload Requirements Document/i }))

    const second = within(container).getByRole('heading', { level: 1 }).nextElementSibling
      ?.textContent
    expect(second).not.toBe(first)
  })
})

/**
 * The whole upload path, end to end.
 *
 * Step one gates on a document, so nothing past it ran before. Everything
 * below is what an owner does between choosing the path and the project
 * existing: price it, list the skills, review, submit.
 */
describe('the upload path from the document to the project', () => {
  /** Presign, then the PUT straight to storage, then whatever the page asks. */
  function stubUploadAndCreate(created: unknown = { id: 'p-1' }) {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('presigned-url')) {
        return { success: true, data: { url: 'https://storage.example/put', key: 'docs/brd.pdf' } }
      }
      return { success: true, data: created }
    })
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as typeof fetch
  }

  async function completeStepOne(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Upload Requirements Document/i }))
    await screen.findByRole('button', { name: 'Next' })

    await user.type(screen.getByLabelText(/project title/i), 'Toko Online Batik')
    await user.type(screen.getByLabelText(/description/i), 'Marketplace batik untuk UMKM lokal')
    await user.selectOptions(screen.getByLabelText(/category/i), 'web_app')
    await user.click(screen.getByRole('button', { name: 'BRD only' }))

    const file = new File(['%PDF-1.4'], 'brd.pdf', { type: 'application/pdf' })
    await user.upload(document.getElementById('doc-upload') as HTMLInputElement, file)
    await screen.findByText('brd.pdf')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Minimum Budget/i)
  }

  async function openAtBudget() {
    const user = userEvent.setup()
    stubUploadAndCreate()
    await render()
    await completeStepOne(user)
    return user
  }

  it('advances once the document and its type are both supplied', async () => {
    await openAtBudget()

    expect(screen.getByLabelText(/Minimum Budget/i)).toBeDefined()
    expect(screen.queryByLabelText(/project title/i)).toBeNull()
  })

  it('names every missing figure on the budget step', async () => {
    const user = await openAtBudget()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/minimum budget is required/i)).toBeDefined()
    expect(screen.getByText(/maximum budget is required/i)).toBeDefined()
    expect(screen.getByText(/timeline is required/i)).toBeDefined()
  })

  /** A maximum at or below the minimum is a range nothing can be priced into. */
  it('refuses a maximum that does not exceed the minimum', async () => {
    const user = await openAtBudget()

    await user.type(screen.getByLabelText(/Minimum Budget/i), '10000000')
    await user.type(screen.getByLabelText(/Maximum Budget/i), '10000000')
    await user.type(screen.getByLabelText(/Estimated Timeline/i), '60')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Maximum budget must be greater than minimum')).toBeDefined()
  })

  it('goes back to the first step with the answers intact', async () => {
    const user = await openAtBudget()

    await user.click(screen.getByRole('button', { name: /^Back$/ }))

    expect(await screen.findByDisplayValue('Toko Online Batik')).toBeDefined()
  })

  async function reachPreferences(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Minimum Budget/i), '10000000')
    await user.type(screen.getByLabelText(/Maximum Budget/i), '50000000')
    await user.type(screen.getByLabelText(/Estimated Timeline/i), '60')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('textbox', { name: /Required Skills/i })
  }

  it('adds a skill, refuses a duplicate, and drops one on request', async () => {
    const user = await openAtBudget()
    await reachPreferences(user)
    const input = screen.getByRole('textbox', { name: /Required Skills/i })

    await user.type(input, '  React  {Enter}')
    expect(await screen.findByText('React')).toBeDefined()

    await user.type(input, 'React{Enter}')
    expect(screen.getAllByText('React')).toHaveLength(1)

    await user.type(input, '   {Enter}')
    expect(screen.getAllByText('React')).toHaveLength(1)

    await user.type(input, 'Go{Enter}')
    await screen.findByText('Go')
    await user.click(screen.getByRole('button', { name: 'Remove React' }))

    await waitFor(() => expect(screen.queryByText('React')).toBeNull())
    expect(screen.getByText('Go')).toBeDefined()
  })

  it('creates the project and sends the owner to scoping', async () => {
    const user = await openAtBudget()
    await reachPreferences(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(await screen.findByRole('button', { name: /Submit Project/i }))

    await waitFor(() => {
      const posts = apiFetch.mock.calls.filter(([u]) => String(u).endsWith('/api/v1/projects'))
      expect(posts.length).toBeGreaterThan(0)
    })
    expect(useToastStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
  })

  it('carries the uploaded document through to the payload', async () => {
    const user = await openAtBudget()
    await reachPreferences(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(await screen.findByRole('button', { name: /Submit Project/i }))

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(1))
    const post = apiFetch.mock.calls.find(([u]) => String(u).endsWith('/api/v1/projects'))
    expect(String((post?.[1] as RequestInit)?.body)).toContain('docs/brd.pdf')
  })

  /** A rejected create must leave the owner their answers and a reason. */
  it('reports a failed create without losing the form', async () => {
    const user = userEvent.setup()
    stubUploadAndCreate()
    await render()
    await completeStepOne(user)
    await reachPreferences(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    apiFetch.mockRejectedValue(new Error('boom'))
    await user.click(await screen.findByRole('button', { name: /Submit Project/i }))

    expect(await screen.findByText('Failed to create project. Please try again.')).toBeDefined()
  })

  it('stays on the review step when the reply carries no id', async () => {
    const user = userEvent.setup()
    stubUploadAndCreate({})
    await render()
    await completeStepOne(user)
    await reachPreferences(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(await screen.findByRole('button', { name: /Submit Project/i }))

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(1))
    expect(screen.getByRole('button', { name: /Submit Project/i })).toBeDefined()
  })
})
