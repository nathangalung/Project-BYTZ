// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as requestProjectRoute from './request-project'

/**
 * The owner's front door: the four-step wizard that turns a rough idea into a
 * project the platform can scope.
 *
 * Nothing mounted it before, so the step gating, the draft it writes to
 * localStorage and the sign-in wall at the end were all unexecuted. The gate
 * is the part that matters: it is the only thing standing between a blank form
 * and a project record, and the whole scoping flow downstream assumes a title,
 * a category, a description and a coherent budget range.
 */

vi.setConfig({ testTimeout: 30_000 })

const DRAFT_KEY = 'kerjacus-draft-project'

const DESTINATIONS = ['/', '/register', '/login', '/projects/new']

function render() {
  return renderRoute(requestProjectRoute, {
    path: '/request-project',
    destinations: DESTINATIONS,
  })
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

/** Fill step one well enough to unlock the Next button. */
async function fillBasics(user: ReturnType<typeof userEvent.setup>, title = 'Toko Online Kopi') {
  await user.type(screen.getByLabelText(/Project Title/), title)
  await user.selectOptions(screen.getByLabelText(/Category/), 'web_app')
  await user.type(screen.getByLabelText(/Description/), 'Marketplace kopi lokal')
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

  it('holds the wizard shut until every required field is filled', async () => {
    const user = userEvent.setup()
    await render()

    expect(next().disabled).toBe(true)

    await user.type(screen.getByLabelText(/Project Title/), 'Toko Online Kopi')
    expect(next().disabled).toBe(true)

    await user.selectOptions(screen.getByLabelText(/Category/), 'web_app')
    expect(next().disabled).toBe(true)

    await user.type(screen.getByLabelText(/Description/), 'Marketplace kopi lokal')
    expect(next().disabled).toBe(false)
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

  it('defaults visibility to the public summary', async () => {
    await render()

    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: /Public \(Summary\)/ }).checked,
    ).toBe(true)
  })

  it('lets the owner keep the project private instead', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('radio', { name: /Private/ }))

    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Private/ }).checked).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: /Public \(Summary\)/ }).checked,
    ).toBe(false)
  })
})

describe('the budget step', () => {
  it('will not advance on a budget range that runs backwards', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await fillBudget(user, '10000000', '5000000', '30')

    expect(next().disabled).toBe(true)
  })

  it('accepts a range where the minimum equals the maximum', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await fillBudget(user, '5000000', '5000000', '30')

    expect(next().disabled).toBe(false)
  })

  it('will not advance without a timeline', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await user.type(screen.getByLabelText(/Minimum Budget/), '5000000')
    await user.type(screen.getByLabelText(/Maximum Budget/), '9000000')

    expect(next().disabled).toBe(true)
  })

  it('echoes each amount back as formatted Rupiah', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await user.type(screen.getByLabelText(/Minimum Budget/), '5000000')
    await user.type(screen.getByLabelText(/Maximum Budget/), '12500000')

    expect(screen.getByText('Rp 5.000.000')).toBeDefined()
    expect(screen.getByText('Rp 12.500.000')).toBeDefined()
  })

  it('echoes nothing back for a budget of zero, and will not advance on it', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await user.type(screen.getByLabelText(/Minimum Budget/), '0')
    await user.type(screen.getByLabelText(/Maximum Budget/), '0')
    await user.type(screen.getByLabelText(/Estimated Timeline/), '30')

    expect(screen.queryByText(/^Rp/)).toBeNull()
    expect(next().disabled).toBe(true)
  })

  it('refuses non-digits in the budget fields', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await user.type(screen.getByLabelText(/Minimum Budget/), 'Rp 5.000.000')

    expect(screen.getByLabelText<HTMLInputElement>(/Minimum Budget/).value).toBe('5000000')
  })

  it('sets out what happens after submission', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    expect(screen.getByText('What happens next')).toBeDefined()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('goes back to basic info without losing what was typed', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 1)

    await user.click(screen.getByRole('button', { name: /^Back/ }))

    expect(screen.getByLabelText<HTMLInputElement>(/Project Title/).value).toBe('Toko Online Kopi')
  })
})

describe('the talent preferences step', () => {
  it('says outright that the whole step is optional', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    expect(screen.getByText(/This section is optional/)).toBeDefined()
    expect(next().disabled).toBe(false)
  })

  it('adds a skill from the button and clears the field', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    await user.type(screen.getByLabelText(/Required Skills/), 'React')
    await user.click(screen.getByRole('button', { name: '+' }))

    expect(screen.getByText('React')).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>(/Required Skills/).value).toBe('')
  })

  it('adds a skill on Enter without submitting the form', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    await user.type(screen.getByLabelText(/Required Skills/), 'Node.js{Enter}')

    expect(screen.getByText('Node.js')).toBeDefined()
  })

  it('ignores a repeat of a skill already on the list', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    await user.type(screen.getByLabelText(/Required Skills/), 'React{Enter}')
    await user.type(screen.getByLabelText(/Required Skills/), 'React{Enter}')

    expect(screen.getAllByText('React')).toHaveLength(1)
  })

  it('trims a skill before adding it', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    await user.type(screen.getByLabelText(/Required Skills/), '  Figma  {Enter}')

    expect(screen.getByText('Figma')).toBeDefined()
  })

  it('will not add whitespace as a skill', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    const add = screen.getByRole('button', { name: '+' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)

    await user.type(screen.getByLabelText(/Required Skills/), '   ')

    expect(add.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Required Skills/), '{Enter}')
    expect(screen.getByLabelText<HTMLInputElement>(/Required Skills/).value).toBe('')
  })

  /**
   * The remove control is an icon with no accessible name, so it is reached
   * through the chip that holds it. See the report: that is a defect, not a
   * query style.
   */
  it('removes a skill again', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)
    await user.type(screen.getByLabelText(/Required Skills/), 'React{Enter}')
    await user.type(screen.getByLabelText(/Required Skills/), 'Figma{Enter}')

    const chip = screen.getByText('React').closest('span') as HTMLElement
    await user.click(within(chip).getByRole('button'))

    expect(screen.queryByText('React')).toBeNull()
    expect(screen.getByText('Figma')).toBeDefined()
  })

  it('keeps ignoring a key that is not Enter', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)

    await user.type(screen.getByLabelText(/Required Skills/), 'React{Tab}')

    expect(screen.getByLabelText<HTMLInputElement>(/Required Skills/).value).toBe('React')
  })
})

describe('the review step', () => {
  it('plays back everything the owner entered', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)

    expect(screen.getByRole('heading', { level: 2, name: 'Review & Submit' })).toBeDefined()
    expect(screen.getByText('Toko Online Kopi')).toBeDefined()
    expect(screen.getByText('Web App')).toBeDefined()
    expect(screen.getByText('Marketplace kopi lokal')).toBeDefined()
    expect(screen.getByText('Rp 5.000.000 - Rp 10.000.000')).toBeDefined()
    expect(screen.getByText('45 days')).toBeDefined()
  })

  it('leaves out the optional rows that were never filled', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)

    expect(screen.queryByText('Preferred Almamater')).toBeNull()
    expect(screen.queryByText('Skills')).toBeNull()
    expect(screen.queryByText(/^Minimum Experience/)).toBeNull()
  })

  it('plays back the optional preferences when they were filled', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 2)
    await user.type(screen.getByLabelText(/Required Skills/), 'React{Enter}')
    await user.type(screen.getByLabelText(/Preferred Almamater/), 'ITB')
    await user.type(screen.getByLabelText(/Minimum Experience/), '3')
    await user.click(next())

    expect(screen.getByText('Skills')).toBeDefined()
    expect(screen.getByText('ITB')).toBeDefined()
    expect(screen.getByText('3 years')).toBeDefined()
  })

  it('offers submit rather than next on the last step', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)

    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Submit Project/ })).toBeDefined()
  })
})

describe('submitting', () => {
  it('saves the draft and sends a signed-in owner into the project flow', async () => {
    const user = userEvent.setup()
    signedIn()
    await render()
    await toStep(user, 3)

    await user.click(screen.getByRole('button', { name: /Submit Project/ }))

    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) as string)).toEqual({
      title: 'Toko Online Kopi',
      category: 'web_app',
      description: 'Marketplace kopi lokal',
      budgetMin: '5000000',
      budgetMax: '10000000',
      timeline: '45',
      almamater: '',
      minExp: '',
      visibility: 'public_summary',
      skills: [],
    })
    expect(screen.queryByText('Sign in to submit your project')).toBeNull()
  })

  it('navigates a signed-in owner to the project creation page', async () => {
    const user = userEvent.setup()
    signedIn()
    const { router } = await render()
    await toStep(user, 3)

    await user.click(screen.getByRole('button', { name: /Submit Project/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/new'))
  })

  it('stops a guest at a sign-in wall but keeps their draft', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)

    await user.click(screen.getByRole('button', { name: /Submit Project/ }))

    expect(await screen.findByText('Sign in to submit your project')).toBeDefined()
    expect(
      screen.getByText('You need an account to follow progress and approve milestones.'),
    ).toBeDefined()
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) as string).title).toBe('Toko Online Kopi')
  })

  it('offers a guest both ways in from the wall', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    await user.click(screen.getByRole('button', { name: /Submit Project/ }))

    expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/register')
    expect(screen.getByRole('link', { name: 'Sign In' }).getAttribute('href')).toBe('/login')
  })

  it('lets a guest dismiss the wall and return to the review', async () => {
    const user = userEvent.setup()
    await render()
    await toStep(user, 3)
    await user.click(screen.getByRole('button', { name: /Submit Project/ }))
    expect(await screen.findByText('Sign in to submit your project')).toBeDefined()

    await user.click(screen.getAllByRole('button', { name: /^Back/ }).at(-1) as HTMLElement)

    expect(screen.queryByText('Sign in to submit your project')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Review & Submit' })).toBeDefined()
  })

  it('records a non-default visibility in the draft', async () => {
    const user = userEvent.setup()
    await render()
    await fillBasics(user)
    await user.click(screen.getByRole('radio', { name: /Public \(Detailed\)/ }))
    await user.click(next())
    await fillBudget(user)
    await user.click(next())
    await user.click(next())

    await user.click(screen.getByRole('button', { name: /Submit Project/ }))

    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) as string).visibility).toBe('public_detail')
  })
})

describe('the step indicator', () => {
  it('marks the steps already passed as done', async () => {
    const user = userEvent.setup()
    const { container } = await render()

    const dots = () => container.querySelectorAll('.rounded-full.border-2')
    expect(dots()[0].className).toContain('border-primary-500')

    await toStep(user, 1)

    expect(dots()[0].className).toContain('bg-primary-600')
    expect(dots()[1].className).toContain('border-primary-500')
  })

  it('names all four steps', async () => {
    await render()

    for (const label of ['Basic Info', 'Budget & Timeline', 'Preferences', 'Review & Submit']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })
})
