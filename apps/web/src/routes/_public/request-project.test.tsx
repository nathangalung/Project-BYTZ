// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as requestProjectRoute from './request-project'

/**
 * The public front door. It renders the same shared step components the
 * signed-in owner wizard uses, so this suite checks the parts that belong to
 * the route itself: step gating on click, the draft it writes under the
 * FormData field names the owner wizard reads, and the sign-in wall at the end.
 */

vi.setConfig({ testTimeout: 30_000 })

const DRAFT_KEY = 'kerjacus-draft-project'
const DESTINATIONS = ['/', '/register', '/login', '/projects/new']

function render() {
  return renderRoute(requestProjectRoute, { path: '/request-project', destinations: DESTINATIONS })
}

function signedOut() {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
}

function signedIn() {
  useAuthStore.setState({
    user: { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
}

const next = () => screen.getByRole('button', { name: /^Next/ }) as HTMLButtonElement
const readDraft = () => JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}')

async function fillBasics(user: ReturnType<typeof userEvent.setup>, title = 'Toko Online Kopi') {
  await user.type(screen.getByLabelText(/Project Title/), title)
  await user.selectOptions(screen.getByLabelText(/Category/), 'web_app')
  await user.type(screen.getByLabelText(/Description/), 'Marketplace kopi lokal untuk UMKM')
}

async function fillBudget(
  user: ReturnType<typeof userEvent.setup>,
  min = '5000000',
  max = '10000000',
  days = '45',
) {
  await user.type(screen.getByLabelText(/Minimum Budget/), min)
  await user.type(screen.getByLabelText(/Maximum Budget/), max)
  await user.type(screen.getByLabelText(/Estimated Timeline/), days)
}

async function toStep(user: ReturnType<typeof userEvent.setup>, target: 1 | 2 | 3) {
  await fillBasics(user)
  await user.click(next())
  if (target === 1) return
  await fillBudget(user)
  await user.click(next())
  if (target === 2) return
  await user.click(next())
}

beforeEach(() => {
  localStorage.removeItem(DRAFT_KEY)
  signedOut()
})

describe('the first step', () => {
  it('opens on basic info with the wizard header', async () => {
    await render()
    expect(screen.getByRole('heading', { level: 1, name: 'Create New Project' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Basic Info' })).toBeDefined()
  })

  it('offers a way home instead of a back button', async () => {
    await render()
    expect(screen.getByRole('link', { name: /Home/ }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('button', { name: /^Back/ })).toBeNull()
  })

  it('will not advance until every required field is filled', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(next())
    // Still on basic info, with the field errors shown.
    expect(screen.getByRole('heading', { level: 2, name: 'Basic Info' })).toBeDefined()

    await fillBasics(user)
    await user.click(next())
    expect(screen.getByRole('heading', { level: 2, name: /Budget/ })).toBeDefined()
  })

  it('rejects a title shorter than the minimum', async () => {
    const user = userEvent.setup()
    await render()
    await user.type(screen.getByLabelText(/Project Title/), 'ab')
    await user.selectOptions(screen.getByLabelText(/Category/), 'web_app')
    await user.type(screen.getByLabelText(/Description/), 'Marketplace kopi lokal untuk UMKM')
    await user.click(next())
    // Too short, so it does not advance.
    expect(screen.getByRole('heading', { level: 2, name: 'Basic Info' })).toBeDefined()
  })

  it('rejects a description shorter than the minimum', async () => {
    const user = userEvent.setup()
    await render()
    await user.type(screen.getByLabelText(/Project Title/), 'Toko Online Kopi')
    await user.selectOptions(screen.getByLabelText(/Category/), 'web_app')
    await user.type(screen.getByLabelText(/Description/), 'short')
    await user.click(next())
    expect(screen.getByRole('heading', { level: 2, name: 'Basic Info' })).toBeDefined()
  })

  it('lists the five project categories the platform scopes', async () => {
    await render()
    const options = within(screen.getByLabelText(/Category/)).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'Select project category',
      'Web App',
      'Mobile App',
      'UI/UX Design',
      'Data/AI',
      'Other Digital',
    ])
  })

  it('records a chosen visibility (set on the preferences step) in the draft', async () => {
    const user = userEvent.setup()
    signedIn()
    await render()

    await toStep(user, 2)
    await user.click(screen.getByRole('radio', { name: /Private/i }))
    await user.click(next())
    await user.click(screen.getByRole('button', { name: /Submit/ }))

    expect(readDraft().visibility).toBe('private')
  })
})

describe('the budget step', () => {
  it('will not advance on a budget range that runs backwards', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)
    await fillBudget(user, '10000000', '5000000', '30')
    await user.click(next())
    expect(screen.getByRole('heading', { level: 2, name: /Budget/ })).toBeDefined()
  })

  it('accepts a range where the minimum equals the maximum', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)
    await fillBudget(user, '5000000', '5000000', '30')
    await user.click(next())
    expect(screen.getByRole('heading', { level: 2, name: /Preferences/ })).toBeDefined()
  })

  it('will not advance without a timeline', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)
    await user.type(screen.getByLabelText(/Minimum Budget/), '5000000')
    await user.type(screen.getByLabelText(/Maximum Budget/), '10000000')
    await user.click(next())
    expect(screen.getByRole('heading', { level: 2, name: /Budget/ })).toBeDefined()
  })

  it('will not advance on a budget of zero', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)
    await fillBudget(user, '0', '0', '30')
    await user.click(next())
    expect(screen.getByRole('heading', { level: 2, name: /Budget/ })).toBeDefined()
  })

  it('goes back to basic info without losing what was typed', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)
    await user.click(screen.getByRole('button', { name: /^Back/ }))
    expect((screen.getByLabelText(/Project Title/) as HTMLInputElement).value).toBe(
      'Toko Online Kopi',
    )
  })
})

describe('the talent preferences step', () => {
  const addBtn = () => screen.getByRole('button', { name: '+' })

  it('adds a skill from the button and clears the field', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)
    const input = screen.getByPlaceholderText(/Type a skill/i) as HTMLInputElement
    await user.type(input, 'React')
    await user.click(addBtn())
    expect(screen.getByText('React')).toBeDefined()
    expect(input.value).toBe('')
  })

  it('ignores a repeat of a skill already on the list', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)
    const input = screen.getByPlaceholderText(/Type a skill/i)
    await user.type(input, 'React')
    await user.click(addBtn())
    await user.type(input, 'React')
    await user.click(addBtn())
    expect(screen.getAllByText('React')).toHaveLength(1)
  })

  it('removes a skill again', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)
    const input = screen.getByPlaceholderText(/Type a skill/i)
    await user.type(input, 'React')
    await user.click(addBtn())
    await user.click(screen.getByRole('button', { name: /Remove React/i }))
    expect(screen.queryByText('React')).toBeNull()
  })
})

describe('the review step', () => {
  it('offers submit rather than next on the last step', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Submit/ })).toBeDefined()
  })

  it('plays back the title the owner entered', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    expect(screen.getAllByText('Toko Online Kopi').length).toBeGreaterThan(0)
  })
})

describe('submitting', () => {
  it('saves the draft under FormData field names and sends a signed-in owner on', async () => {
    const user = userEvent.setup()
    signedIn()
    await render()
    await toStep(user, 3)
    await user.click(screen.getByRole('button', { name: /Submit/ }))

    const draft = readDraft()
    expect(draft.title).toBe('Toko Online Kopi')
    expect(draft.category).toBe('web_app')
    expect(draft.estimatedTimelineDays).toBe('45')
    expect(draft.requiredSkills).toEqual([])
    // The owner wizard reads these exact keys; the old timeline/minExp are gone.
    expect(draft.timeline).toBeUndefined()
    expect(draft.minExp).toBeUndefined()
    // A signed-in owner is routed straight on, so the sign-in wall never shows.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull())
    expect(screen.queryByRole('link', { name: /Register/i })).toBeNull()
  })

  it('stops a guest at a sign-in wall but keeps their draft', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    await user.click(screen.getByRole('button', { name: /Submit/ }))

    expect(await screen.findByRole('link', { name: /Register/i })).toBeDefined()
    expect(readDraft().title).toBe('Toko Online Kopi')
  })

  it('offers a guest both ways in from the wall', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    await user.click(screen.getByRole('button', { name: /Submit/ }))

    expect((await screen.findByRole('link', { name: /Register/i })).getAttribute('href')).toBe(
      '/register',
    )
    expect(screen.getByRole('link', { name: /Sign In/i }).getAttribute('href')).toBe('/login')
  })

  /**
   * Nothing here awaits a server, but the draft is written and the page is
   * handed over, so a second press would be a second handoff. The button
   * reports that the same way the owner wizard reports its mutation.
   */
  it('locks the submit button and reports progress once the handoff starts', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    const submit = screen.getByRole('button', { name: /Submit Project/ }) as HTMLButtonElement

    await user.click(submit)

    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('Submitting')
  })

  it('releases the submit button when the guest dismisses the wall', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    const submit = screen.getByRole('button', { name: /Submit Project/ }) as HTMLButtonElement
    await user.click(submit)

    await user.keyboard('{Escape}')

    await waitFor(() => expect(submit.disabled).toBe(false))
    expect(submit.textContent).toContain('Submit Project')
  })

  it('lets a guest dismiss the wall and return to the review', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    await user.click(screen.getByRole('button', { name: /Submit/ }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('link', { name: /Register/i })).toBeNull())
    expect(screen.getByRole('button', { name: /Submit/ })).toBeDefined()
  })
})

describe('the step indicator', () => {
  /**
   * The indicator renders before the card, and its buttons carry only an icon,
   * so they are the first four buttons on the page and are found by position.
   */
  const stepButton = (container: HTMLElement, index: number) =>
    container.querySelectorAll('button')[index] as HTMLButtonElement

  it('names all four steps', async () => {
    await render()
    for (const label of ['Basic Info', 'Budget', 'Preferences', 'Review']) {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0)
    }
  })

  /**
   * Same as the owner wizard: a step already passed is a step worth going back
   * to, and doing it from the indicator beats pressing Back three times.
   */
  it('jumps back to a step already passed, keeping what was typed', async () => {
    const user = userEvent.setup()
    const { container } = await render()
    await toStep(user, 3)

    await user.click(stepButton(container, 0))

    expect(screen.getByRole('heading', { level: 2, name: 'Basic Info' })).toBeDefined()
    expect((screen.getByLabelText(/Project Title/) as HTMLInputElement).value).toBe(
      'Toko Online Kopi',
    )
  })

  it('will not jump ahead to a step not yet reached', async () => {
    const user = userEvent.setup()
    const { container } = await render()

    await user.click(stepButton(container, 3))

    expect(screen.getByRole('heading', { level: 2, name: 'Basic Info' })).toBeDefined()
  })
})
