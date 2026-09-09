// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as talentHome from './index'

/**
 * The talent's home page, and the gate in front of the whole talent side.
 *
 * It fans out to seven endpoints at once, so every stub below is routed by
 * path rather than sequenced. The branches worth the effort are the redirect
 * when the profile is gone, the apply button that must not fire twice, and the
 * assignment offers - the only place on the platform where a talent commits to
 * work and to a payout figure.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})
vi.mock('@/lib/centrifugo', () => ({
  connectCentrifugo: vi.fn(),
  disconnectCentrifugo: vi.fn(),
  subscribeTo: vi.fn(() => vi.fn()),
}))

const PROFILE = {
  id: 'tp-1',
  userId: 'u-9',
  // Applying needs both. A profile without them may browse, not apply.
  cvFileUrl: 'cv/tp-1.pdf',
  verificationStatus: 'verified',
  totalProjectsActive: 2,
  totalProjectsCompleted: 11,
  averageRating: 4.62,
}

const PROJECT = {
  id: 'p-1',
  title: 'Marketplace UMKM Bandung',
  category: 'web_app',
  payoutMin: 8_342_647,
  payoutMax: 12_035_294,
  openPositions: 2,
  preferences: { requiredSkills: ['React', 'Hono'] },
  createdAt: '2026-08-01T03:00:00.000Z',
  estimatedTimelineDays: 45,
}

/** A promise that never settles, so the view stays in its loading state. */
const NEVER = () => new Promise(() => {})

type Plan = {
  profile?: unknown | 'error' | 'loading'
  available?: unknown | 'error' | 'loading'
  active?: unknown | 'loading' | 'error'
  offers?: unknown
  applications?: unknown
  notifications?: unknown | 'error'
  timeLogs?: unknown
  onApply?: () => Promise<unknown>
  onRespond?: () => Promise<unknown>
}
let plan: Plan = {}

function envelope(data: unknown) {
  return Promise.resolve({ success: true, data })
}

function route(url: string): Promise<unknown> {
  if (url.includes('/applications') && !url.includes('/applications/talent')) {
    return plan.onApply ? plan.onApply() : envelope({ id: 'app-1' })
  }
  if (url.includes('/matching/assignments/')) {
    return plan.onRespond ? plan.onRespond() : envelope({ ok: true })
  }
  if (url.includes('/talent-profiles/user/')) {
    if (plan.profile === 'loading') return NEVER()
    if (plan.profile === 'error') return Promise.reject(new Error('no profile'))
    // A 200 carrying no row, which is not the same as a refusal.
    if (plan.profile === 'none') return envelope(null)
    return envelope(plan.profile ?? PROFILE)
  }
  if (url.includes('/projects/available')) {
    if (plan.available === 'loading') return NEVER()
    if (plan.available === 'error') return Promise.reject(new Error('down'))
    return envelope(plan.available ?? { items: [], total: 0 })
  }
  if (url.includes('/active-projects')) {
    if (plan.active === 'loading') return NEVER()
    if (plan.active === 'error') return Promise.reject(new Error('down'))
    return envelope(plan.active ?? [])
  }
  if (url.includes('/matching/my-offers')) return envelope(plan.offers ?? [])
  if (url.includes('/applications/talent/')) return envelope(plan.applications ?? [])
  if (url.includes('/notifications')) {
    if (plan.notifications === 'error') return Promise.reject(new Error('down'))
    return envelope(plan.notifications ?? { items: [], total: 0 })
  }
  if (url.includes('/time-logs/talent/')) return envelope(plan.timeLogs ?? [])
  return envelope({})
}

function render() {
  return renderRoute(talentHome, {
    path: '/talent',
    destinations: ['/talent/register', '/projects/$projectId'],
  })
}

function toasts() {
  return useToastStore.getState().toasts.map((t) => `${t.type}:${t.message}`)
}
/** The JSON body of a recorded request, or a named failure if none matched. */
function sentBody(call: unknown[] | undefined): Record<string, unknown> {
  if (!call) throw new Error('no matching request was sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((url: string) => route(String(url)))
  plan = {}
  localStorage.clear()
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
})

/**
 * The profile is what every other query on this page keys off, so a talent
 * whose profile row is gone has to be sent back to registration rather than
 * left on a dashboard of empty panels.
 */
describe('the profile guard', () => {
  it('sends a talent with no profile back to registration', async () => {
    plan.profile = 'error'
    localStorage.setItem('kerjacus-profile-complete', 'u-9')

    const { router } = await render()

    await waitFor(() => expect(router.state.location.pathname).toBe('/talent/register'))
    expect(localStorage.getItem('kerjacus-profile-complete')).toBeNull()
  })

  it('records the finished profile and stays put', async () => {
    const { router } = await render()

    await waitFor(() => expect(localStorage.getItem('kerjacus-profile-complete')).toBe('u-9'))
    expect(router.state.location.pathname).toBe('/talent')
  })

  /**
   * apiFetch calls logout() on any 401, so a token expiring under a mounted
   * page empties the session. Redirecting then would race the layout guard and
   * send the talent to registration instead of to the login page.
   */
  it('asks for nothing and redirects nobody when the session has emptied out', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })

    const { router } = await render()

    expect(router.state.location.pathname).toBe('/talent')
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('/talent-profiles/user/'))).toBe(
      false,
    )
  })

  it('redirects nobody while the profile request is still in flight', async () => {
    plan.profile = 'loading'
    localStorage.setItem('kerjacus-profile-complete', 'u-9')

    const { router } = await render()

    expect(router.state.location.pathname).toBe('/talent')
    expect(localStorage.getItem('kerjacus-profile-complete')).toBe('u-9')
  })
})

describe('the stat cards', () => {
  it('reads the counts and the rating off the profile', async () => {
    plan.timeLogs = [{ durationMinutes: 90 }, { durationMinutes: 45 }]

    const { container } = await render()

    await screen.findByText('11')
    expect(screen.getByText('2')).toBeDefined()
    expect(screen.getByText('4.6')).toBeDefined()
    await waitFor(() => expect(within(container).getByText('2')).toBeDefined())
  })

  it('rounds logged minutes to whole hours', async () => {
    plan.timeLogs = [{ durationMinutes: 100 }, { durationMinutes: 50 }, { durationMinutes: null }]

    await render()

    expect(await screen.findByText('3')).toBeDefined()
  })

  /** A talent with no rating yet must not read as a zero-rated one. */
  it('shows a placeholder rather than a zero before the first rating', async () => {
    plan.profile = { ...PROFILE, averageRating: null }

    await render()

    expect(await screen.findByText('--')).toBeDefined()
  })
})

/** Four states, and the pair that must not be confused is loading and empty. */
describe('the available projects panel', () => {
  it('withholds the empty message while the request is in flight', async () => {
    plan.available = 'loading'

    await render()

    expect(screen.queryByText('No projects matching your skills yet')).toBeNull()
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
  })

  it('offers a retry when the request fails', async () => {
    plan.available = 'error'

    await render()

    expect(await screen.findByRole('button', { name: /try again/i })).toBeDefined()
  })

  it('refetches from the retry button', async () => {
    plan.available = 'error'
    const user = userEvent.setup()
    await render()

    const before = apiFetch.mock.calls.filter((c) =>
      String(c[0]).includes('/projects/available'),
    ).length
    await user.click(await screen.findByRole('button', { name: /try again/i }))

    await waitFor(() =>
      expect(
        apiFetch.mock.calls.filter((c) => String(c[0]).includes('/projects/available')).length,
      ).toBeGreaterThan(before),
    )
  })

  it('says so plainly when there is nothing to apply for', async () => {
    await render()

    expect(await screen.findByText('No projects matching your skills yet')).toBeDefined()
  })

  it('lists a project with its budget, timeline and required skills', async () => {
    plan.available = { items: [PROJECT], total: 1 }

    await render()

    expect(await screen.findByText('Marketplace UMKM Bandung')).toBeDefined()
    expect(screen.getByText('React')).toBeDefined()
    expect(screen.getByText('Hono')).toBeDefined()
    // The bracket the owner picked, not the midpoint stored behind it.
    expect(screen.getByText(/1-2 Months|1-2 Bulan/)).toBeDefined()
  })

  /**
   * The card used to print the owner's intake budget, a number several times
   * what the seat pays, and a note underneath asked the talent to disregard it.
   * It now prints the payout of the seats still open, so the figure and the
   * decision are about the same money.
   */
  it('quotes the payout of the open seats, not the owner budget', async () => {
    plan.available = { items: [PROJECT], total: 1 }

    await render()

    expect(await screen.findByText(/Payout per open position/)).toBeDefined()
    expect(screen.getByText(/Rp\s?8\.342\.647 - Rp\s?12\.035\.294/)).toBeDefined()
  })

  it('still says the exact amount is fixed at the offer', async () => {
    plan.available = { items: [PROJECT], total: 1 }

    await render()

    expect(screen.getByText(/exact amount is fixed when the offer is sent/)).toBeDefined()
  })

  it('collapses a single open seat to one figure rather than a range', async () => {
    plan.available = {
      items: [{ ...PROJECT, payoutMin: 500_000, payoutMax: 500_000, openPositions: 1 }],
      total: 1,
    }

    await render()

    expect(await screen.findByText(/^Rp\s?500\.000$/)).toBeDefined()
  })

  it('says there is nothing open rather than quoting nothing', async () => {
    plan.available = {
      items: [{ ...PROJECT, payoutMin: null, payoutMax: null, openPositions: 0 }],
      total: 1,
    }

    await render()

    expect(await screen.findByText(/No open positions/)).toBeDefined()
  })

  it('falls back to a generic look for a category it does not know', async () => {
    plan.available = { items: [{ ...PROJECT, category: 'civil_engineering' }], total: 1 }

    await render()

    expect(await screen.findByText('civil engineering')).toBeDefined()
  })

  it('survives a project carrying no skills at all', async () => {
    plan.available = { items: [{ ...PROJECT, preferences: null }], total: 1 }

    await render()

    expect(await screen.findByText('Marketplace UMKM Bandung')).toBeDefined()
    expect(screen.queryByText('React')).toBeNull()
  })
})

describe('applying to a project', () => {
  beforeEach(() => {
    plan.available = { items: [PROJECT], total: 1 }
  })

  it('sends the application against this talent profile and confirms it', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /^apply$/i }))

    await waitFor(() => expect(toasts()).toContain('success:Application sent successfully!'))
    const call = apiFetch.mock.calls.find(
      (c) => String(c[0]).includes('/applications') && !String(c[0]).includes('/talent/'),
    )
    expect(sentBody(call)).toEqual({ projectId: 'p-1', talentId: 'tp-1' })
  })

  /**
   * A talent may sign up and browse without a CV. The server refuses the
   * application, so a button that only fails on click teaches nothing - the
   * dashboard says why and where to fix it before the click.
   */
  it('disables applying and says why when the profile has no CV', async () => {
    plan.profile = { ...PROFILE, cvFileUrl: null, verificationStatus: 'unverified' }
    await render()

    expect(await screen.findByText(/Upload your CV before applying to a project\./)).toBeDefined()
    expect((await screen.findByRole('button', { name: /^apply$/i })).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('says the CV is still being processed rather than asking for it again', async () => {
    plan.profile = { ...PROFILE, cvFileUrl: 'cv/tp-1.pdf', verificationStatus: 'cv_parsing' }
    await render()

    expect(await screen.findByText(/being processed/i)).toBeDefined()
    expect((await screen.findByRole('button', { name: /^apply$/i })).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('sends nothing when a blocked talent clicks anyway', async () => {
    plan.profile = { ...PROFILE, cvFileUrl: null, verificationStatus: 'unverified' }
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /^apply$/i }))

    expect(
      apiFetch.mock.calls.some(
        (c) => String(c[0]).includes('/applications') && !String(c[0]).includes('/talent/'),
      ),
    ).toBe(false)
  })

  it('reports the reason when the application is refused', async () => {
    plan.onApply = () => Promise.reject(new Error('Already staffed'))
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /^apply$/i }))

    await waitFor(() => expect(toasts()).toContain('error:Already staffed'))
  })

  it('falls back to a generic message when the refusal carries none', async () => {
    plan.onApply = () => Promise.reject('nope')
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /^apply$/i }))

    await waitFor(() => expect(toasts()).toContain('error:Failed to send application'))
  })

  /** A second application is a duplicate row, so the button closes itself. */
  it('shows an already-applied project as applied and refuses a second try', async () => {
    plan.applications = [{ projectId: 'p-1' }]
    await render()

    const button = await screen.findByRole('button', { name: /applied/i })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('reads applications delivered as a page rather than a bare array', async () => {
    plan.applications = { items: [{ projectId: 'p-1' }], total: 1 }
    await render()

    expect((await screen.findByRole('button', { name: /applied/i })).hasAttribute('disabled')).toBe(
      true,
    )
  })

  /**
   * Waits on the cache rather than on the button, because an unreadable
   * answer leaves the button reading "Apply" both before and after the query
   * settles - asserting on it alone would pass without the branch ever running.
   */
  it('treats an unrecognised applications shape as none applied', async () => {
    plan.applications = { count: 1 }
    const { queryClient } = await render()

    await waitFor(() =>
      expect(queryClient.getQueryData(['talent-applications', 'tp-1'])).toBeDefined(),
    )
    expect(await screen.findByRole('button', { name: /^apply$/i })).toBeDefined()
  })

  /** Two presses is two application rows, so the button closes while it runs. */
  it('says it is applying and refuses a second press', async () => {
    let release: (v: unknown) => void = () => {}
    plan.onApply = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /^apply$/i }))

    const working = await screen.findByRole('button', { name: /applying/i })
    expect(working.hasAttribute('disabled')).toBe(true)
    release({ id: 'app-1' })
    await waitFor(() => expect(toasts()).toContain('success:Application sent successfully!'))
  })
})

/**
 * The only place a talent commits to work and to a figure, so the payout has
 * to be on screen beside the accept button rather than a page away.
 */
describe('assignment offers', () => {
  const OFFER = {
    assignmentId: 'a-1',
    projectId: 'p-1',
    projectTitle: 'Marketplace UMKM Bandung',
    workPackageId: 'wp-1',
    workPackageTitle: 'Backend API',
    payout: 7_150_000,
  }

  it('stays out of the way when there are no offers', async () => {
    await render()

    await screen.findByText('No projects matching your skills yet')
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
  })

  it('names the work package, its project and the exact payout', async () => {
    plan.offers = [OFFER]

    await render()

    expect(await screen.findByText('Backend API')).toBeDefined()
    expect(screen.getByText(/7\.150\.000/)).toBeDefined()
  })

  it('accepts an offer and confirms it', async () => {
    plan.offers = [OFFER]
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /accept/i }))

    await waitFor(() => expect(toasts()).toContain('success:Offer accepted'))
    expect(
      apiFetch.mock.calls.some((c) => String(c[0]).includes('/matching/assignments/a-1/accept')),
    ).toBe(true)
  })

  it('declines an offer and confirms it', async () => {
    plan.offers = [OFFER]
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /decline/i }))

    await waitFor(() => expect(toasts()).toContain('success:Offer declined'))
    expect(
      apiFetch.mock.calls.some((c) => String(c[0]).includes('/matching/assignments/a-1/decline')),
    ).toBe(true)
  })

  /** Accept and decline both close while an answer is in flight. */
  it('closes both answers while one of them is in flight', async () => {
    plan.offers = [OFFER]
    let release: (v: unknown) => void = () => {}
    plan.onRespond = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /accept/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /decline/i }).hasAttribute('disabled')).toBe(true),
    )
    expect(screen.getByRole('button', { name: /accept/i }).hasAttribute('disabled')).toBe(true)
    release({ ok: true })
    await waitFor(() => expect(toasts()).toContain('success:Offer accepted'))
  })

  it('reports the reason when an answer is rejected', async () => {
    plan.offers = [OFFER]
    plan.onRespond = () => Promise.reject(new Error('Offer withdrawn'))
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /accept/i }))

    await waitFor(() => expect(toasts()).toContain('error:Offer withdrawn'))
  })

  it('falls back to a generic message when the rejection carries none', async () => {
    plan.offers = [OFFER]
    plan.onRespond = () => Promise.reject('nope')
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: /accept/i }))

    await waitFor(() => expect(toasts()).toContain('error:Could not respond. Please try again.'))
  })
})

describe('the active projects panel', () => {
  const ACTIVE = {
    id: 'p-7',
    title: 'Dashboard Koperasi',
    progress: 60,
    currentMilestone: 'Milestone 2: API',
    deadline: '2026-09-30T00:00:00.000Z',
  }

  /**
   * A failed request and an empty list read the same to a talent, and only one
   * of them can be acted on. The retry refetches this panel alone.
   */
  it('says the active panel failed rather than calling it empty', async () => {
    plan.active = 'error'

    await render()

    expect(
      await screen.findByText(
        'Could not load your active projects. Check your connection and try again.',
      ),
    ).toBeDefined()
    expect(screen.queryByText('No active projects yet')).toBeNull()

    const before = apiFetch.mock.calls.filter((c) =>
      String(c[0]).includes('/active-projects'),
    ).length
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() =>
      expect(
        apiFetch.mock.calls.filter((c) => String(c[0]).includes('/active-projects')).length,
      ).toBeGreaterThan(before),
    )
  })

  it('says so when there is nothing in progress', async () => {
    await render()

    expect(await screen.findByText(/no active/i)).toBeDefined()
  })

  it('links each active project to its own page with its progress and deadline', async () => {
    plan.active = [ACTIVE]

    await render()

    const link = await screen.findByRole('link', { name: /dashboard koperasi/i })
    expect(link.getAttribute('href')).toBe('/projects/p-7')
    expect(within(link).getByText('60%')).toBeDefined()
    expect(within(link).getByText('30 Sep 2026')).toBeDefined()
  })

  it('renders a dash rather than a date for a project with no deadline', async () => {
    plan.active = [{ ...ACTIVE, deadline: null }]

    await render()

    const link = await screen.findByRole('link', { name: /dashboard koperasi/i })
    expect(within(link).getByText('-')).toBeDefined()
  })

  it('renders a dash rather than Invalid Date for an unreadable deadline', async () => {
    plan.active = [{ ...ACTIVE, deadline: 'segera' }]

    await render()

    const link = await screen.findByRole('link', { name: /dashboard koperasi/i })
    expect(within(link).getByText('-')).toBeDefined()
    expect(screen.queryByText(/invalid date/i)).toBeNull()
  })
})

describe('the recent notifications panel', () => {
  const notif = (id: string, type: string, title: string) => ({
    id,
    type,
    title,
    message: '',
    link: null,
    isRead: false,
    createdAt: '2026-08-10T02:00:00.000Z',
  })

  it('says so when there is nothing to read', async () => {
    await render()

    expect(await screen.findByText(/no notification/i)).toBeDefined()
  })

  it('shows at most the three most recent', async () => {
    plan.notifications = {
      items: [
        notif('n1', 'payment', 'Payment released'),
        notif('n2', 'milestone_update', 'Milestone approved'),
        notif('n3', 'system', 'Maintenance window'),
        notif('n4', 'dispute', 'Dispute opened'),
      ],
      total: 4,
    }

    await render()

    expect(await screen.findByText('Payment released')).toBeDefined()
    expect(screen.getByText('Milestone approved')).toBeDefined()
    expect(screen.getByText('Maintenance window')).toBeDefined()
    expect(screen.queryByText('Dispute opened')).toBeNull()
  })
})

/**
 * The bell and this panel share one query, and it used to throw anything that
 * was not a 404 or an offline fetch. `useUnreadCount` is mounted in the
 * _authenticated layout, so one bad answer replaced every signed-in page.
 * Scoped to the panel now: the talent's projects stay on screen.
 */
describe('when the notifications cannot be loaded', () => {
  it('says so in the panel and leaves the rest of the page standing', async () => {
    plan.notifications = 'error'
    plan.available = { items: [PROJECT], total: 1 }

    await render()

    expect(await screen.findByText(PROJECT.title)).toBeDefined()
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toContain(
      'Could not load your notifications',
    )
  })

  it('offers a retry that asks again', async () => {
    plan.notifications = 'error'

    await render()

    const alert = (await screen.findAllByRole('alert'))[0]
    const before = apiFetch.mock.calls.filter((c) => String(c[0]).includes('/notifications')).length
    within(alert).getByRole('button').click()

    await waitFor(() =>
      expect(
        apiFetch.mock.calls.filter((c) => String(c[0]).includes('/notifications')).length,
      ).toBeGreaterThan(before),
    )
  })
})

describe('what the dashboard falls back to', () => {
  /** A 200 with no row is not a refusal, so it must not redirect either. */
  it('stays put and records nothing when the profile comes back empty', async () => {
    plan.profile = 'none'

    await render()

    await waitFor(() => expect(screen.getByText('Available Projects')).toBeDefined())
    expect(localStorage.getItem('kerjacus-profile-complete')).toBeNull()
  })

  it('reads an available-projects answer that carries no items', async () => {
    plan.available = {}

    await render()

    expect(await screen.findByText('No projects matching your skills yet')).toBeDefined()
  })

  /** The hook maps preferences to skills, so a null one still lists. */
  it('lists a project whose preferences carry no skills', async () => {
    plan.available = { items: [{ ...PROJECT, preferences: null }], total: 1 }

    await render()

    expect(await screen.findByText(PROJECT.title)).toBeDefined()
    expect(screen.queryByText('React')).toBeNull()
  })

  /** Scoped to the panel: the projects list draws skeletons of its own. */
  it('skeletons the active panel rather than calling it empty', async () => {
    plan.active = 'loading'

    await render()

    const panel = (await screen.findByRole('heading', { name: 'Active Projects' }))
      .parentElement as HTMLElement
    await waitFor(() => expect(panel.querySelectorAll('.animate-pulse')).toHaveLength(6))
  })
})
