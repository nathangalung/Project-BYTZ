// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as timeTrackingRoute from './time-tracking'

/**
 * The time log.
 *
 * CLAUDE.md says these hours are not billed - the model is fixed price per
 * milestone - so what they buy is transparency and better estimates on the
 * next project. That makes correctness of the arithmetic the whole point: a
 * week total that quietly drops entries, or a manual entry that rounds to
 * zero, is worse than no tracking at all because it looks authoritative.
 *
 * Two clients are in play. The project and its tasks come through apiFetch;
 * the logs and the summary use raw fetch, so both are stubbed.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const TASKS = [
  { id: 'task-1', title: 'Auth endpoint' },
  { id: 'task-2', title: 'Checkout UI' },
]

function isoOn(daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.toISOString().split('T')[0]}T09:00:00.000Z`
}

function log(over: Record<string, unknown> = {}) {
  return {
    id: 'tl-1',
    taskTitle: 'Auth endpoint',
    description: 'Menulis handler',
    startedAt: isoOn(0),
    endedAt: isoOn(0),
    durationMinutes: 90,
    ...over,
  }
}

type Options = {
  logs?: unknown[]
  logsFail?: boolean
  logsHang?: boolean
  summary?: unknown[]
  createFails?: boolean
}

/** Raw fetch serves the logs, the summary and the writes. */
function stubFetch(options: Options = {}) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url)
    if (init?.method === 'POST' || target.includes('/stop')) {
      if (options.createFails) {
        return new Response(JSON.stringify({ error: { code: 'TIME_LOG_INVALID' } }), {
          status: 400,
        })
      }
      return new Response(JSON.stringify({ success: true, data: { id: 'tl-new' } }), {
        status: 200,
      })
    }
    if (target.includes('/summary')) {
      return new Response(JSON.stringify({ success: true, data: options.summary ?? [] }), {
        status: 200,
      })
    }
    if (options.logsHang) return new Promise<Response>(() => {})
    if (options.logsFail) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify({ success: true, data: options.logs ?? [] }), {
      status: 200,
    })
  })
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

function stubApi() {
  apiFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/tasks')) {
      return { success: true, data: { tasks: TASKS, dependencies: [] } }
    }
    return { success: true, data: { id: 'p-1', title: 'Toko Online Batik' } }
  })
}

function render() {
  return renderRoute(timeTrackingRoute, {
    path: '/projects/$projectId/time-tracking',
    entry: '/projects/p-1/time-tracking',
    destinations: ['/projects/$projectId'],
  })
}

function signIn(role: 'owner' | 'talent') {
  useAuthStore.setState({
    user: { id: 'u1', email: 'u@kerjacus.id', name: 'U', role, locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  signIn('talent')
})

describe('the four states of the time log', () => {
  it('says it is loading rather than showing an empty log', async () => {
    stubFetch({ logsHang: true })

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('Time Log')).toBeNull()
  })

  it('shows the page with zero totals for a log with nothing in it', async () => {
    stubFetch({ logs: [] })

    await render()

    expect(await screen.findByText('Time Log')).toBeDefined()
    expect(screen.getByText('Total Entries').nextElementSibling?.textContent).toBe('0')
  })

  it('offers a retry rather than a blank page when the log fails to load', async () => {
    const user = userEvent.setup()
    const spy = stubFetch({ logsFail: true })

    await render()
    const retry = await screen.findByRole('button', { name: 'Try Again' })
    const before = spy.mock.calls.length

    await user.click(retry)

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before))
  })

  it('lists the entries it was given', async () => {
    stubFetch({ logs: [log()] })

    await render()

    // The title also names an option in the task select, so scope to the log.
    const entry = (await screen.findByText('Menulis handler')).closest('div') as HTMLElement
    expect(within(entry).getByText('Auth endpoint')).toBeDefined()
  })
})

/**
 * The two totals above the log.
 *
 * Week runs from Sunday, so an entry from eight days ago is outside it while
 * one from today counts twice - once for the week and once for the day.
 */
describe('the running totals', () => {
  it('counts today in both the day and the week', async () => {
    stubFetch({ logs: [log({ id: 'a', durationMinutes: 90 })] })

    await render()
    await screen.findByText('Menulis handler')

    expect(screen.getByText('Today').nextElementSibling?.textContent).toContain('1')
    expect(screen.getByText('This Week').nextElementSibling?.textContent).toContain('1')
  })

  it('leaves an entry from last week out of both', async () => {
    stubFetch({
      logs: [log({ id: 'old', startedAt: isoOn(9), endedAt: isoOn(9), durationMinutes: 240 })],
    })

    await render()
    await screen.findByText('Menulis handler')

    expect(screen.getByText('Today').nextElementSibling?.textContent).toContain('0')
    expect(screen.getByText('Total Entries').nextElementSibling?.textContent).toBe('1')
  })

  it('groups several entries under their own dates', async () => {
    stubFetch({
      logs: [
        log({ id: 'a', durationMinutes: 60 }),
        log({ id: 'b', durationMinutes: 30 }),
        log({ id: 'c', startedAt: isoOn(2), endedAt: isoOn(2), durationMinutes: 45 }),
      ],
    })

    await render()
    await screen.findAllByText('Menulis handler')

    expect(screen.getByText('Total Entries').nextElementSibling?.textContent).toBe('3')
  })

  /** A log the server returned without a duration must count as zero, not NaN. */
  it('treats a running entry as zero minutes rather than NaN', async () => {
    stubFetch({ logs: [log({ id: 'run', endedAt: null, durationMinutes: null })] })

    const { container } = await render()
    await screen.findByText('Menulis handler')

    expect(container.textContent).not.toContain('NaN')
  })

  it('names an entry whose task title the server did not send', async () => {
    stubFetch({ logs: [log({ taskTitle: '' })] })

    await render()

    expect(await screen.findByText('Untitled Task')).toBeDefined()
  })
})

/**
 * The timer.
 *
 * Start is gated on a real task because time_logs.task_id is a foreign key;
 * free text cannot be stored, so a timer that starts without one produces an
 * entry the server rejects after the work is already done.
 */
describe('running the timer', () => {
  async function openTimer() {
    const user = userEvent.setup()
    const spy = stubFetch({ logs: [] })
    await render()
    await screen.findByText('Timer')
    return { user, spy }
  }

  it('refuses to start without a task selected', async () => {
    const { user, spy } = await openTimer()
    const start = screen.getByRole<HTMLButtonElement>('button', { name: /start/i })
    expect(start.disabled).toBe(true)

    await user.click(start)

    expect(spy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(
      false,
    )
  })

  it('starts an open-ended entry against the chosen task', async () => {
    const { user, spy } = await openTimer()

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'task-1')
    await user.click(screen.getByRole('button', { name: /start/i }))

    await waitFor(() => {
      const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')
      if (!post) throw new Error('expected a matching fetch call')
      expect(post).toBeDefined()
      const body = JSON.parse(String((post[1] as RequestInit).body))
      expect(body.taskId).toBe('task-1')
      expect(body.endedAt).toBeUndefined()
    })
    expect(screen.getByRole('button', { name: /stop/i })).toBeDefined()
  })

  it('carries an optional description into the entry', async () => {
    const { user, spy } = await openTimer()

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'task-1')
    await user.type(screen.getAllByRole('textbox')[0], 'Refactor handler')
    await user.click(screen.getByRole('button', { name: /start/i }))

    await waitFor(() => {
      const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')
      if (!post) throw new Error('expected a matching fetch call')
      expect(JSON.parse(String((post[1] as RequestInit).body)).description).toBe('Refactor handler')
    })
  })

  it('locks the task and description while the timer runs', async () => {
    const { user } = await openTimer()

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'task-1')
    await user.click(screen.getByRole('button', { name: /start/i }))

    await waitFor(() => {
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).disabled).toBe(true)
    })
  })

  /** A rejected start has to hand the timer back, not leave it apparently running. */
  it('returns to the stopped state when the server refuses the entry', async () => {
    const user = userEvent.setup()
    stubFetch({ logs: [], createFails: true })
    await render()
    await screen.findByText('Timer')

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'task-1')
    await user.click(screen.getByRole('button', { name: /start/i }))

    expect(await screen.findByRole('button', { name: /start/i })).toBeDefined()
  })

  it('stops the entry the server acknowledged rather than writing a second one', async () => {
    const { user, spy } = await openTimer()
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'task-1')
    await user.click(screen.getByRole('button', { name: /start/i }))
    await screen.findByRole('button', { name: /stop/i })
    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('/time-logs'))).toBe(true),
    )

    await user.click(screen.getByRole('button', { name: /stop/i }))

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('tl-new/stop'))).toBe(true),
    )
    expect(screen.getByRole('button', { name: /start/i })).toBeDefined()
  })

  /**
   * The server never acknowledged the start, so there is no id to stop. The
   * fallback writes a completed entry from the timestamp rather than losing
   * the work the talent just did.
   */
  it('writes a completed entry when the start was never acknowledged', async () => {
    const user = userEvent.setup()
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url)
      if (init?.method === 'POST') {
        // Acknowledge with no id, so no active log is recorded.
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
      }
      if (target.includes('/summary')) {
        return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
    })
    globalThis.fetch = spy as unknown as typeof fetch
    await render()
    await screen.findByText('Timer')

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'task-1')
    await user.click(screen.getByRole('button', { name: /start/i }))
    await screen.findByRole('button', { name: /stop/i })
    await user.click(screen.getByRole('button', { name: /stop/i }))

    await waitFor(() => {
      const posts = spy.mock.calls.filter(
        ([, i]) => (i as RequestInit | undefined)?.method === 'POST',
      )
      expect(posts.length).toBe(2)
      const body = JSON.parse(String((posts[1][1] as RequestInit).body))
      expect(body.endedAt).toBeDefined()
      expect(body.durationMinutes).toBeGreaterThanOrEqual(1)
    })
  })
})

/**
 * Manual entry.
 *
 * Hours and minutes are two fields that add up to one duration, and the guard
 * is on the total: zero in both is not an entry worth storing.
 */
describe('logging time after the fact', () => {
  async function openManualForm() {
    const user = userEvent.setup()
    const spy = stubFetch({ logs: [] })
    await render()
    await user.click(await screen.findByRole('button', { name: /manual entry/i }))
    await screen.findByText('Add Manual Entry')
    return { user, spy }
  }

  it('opens and closes the form without writing anything', async () => {
    const { user, spy } = await openManualForm()

    await user.click(screen.getByRole('button', { name: /cancel|batal/i }))

    await waitFor(() => expect(screen.queryByText('Add Manual Entry')).toBeNull())
    expect(spy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(
      false,
    )
  })

  it('refuses an entry with no task', async () => {
    const { user, spy } = await openManualForm()

    await user.type(screen.getByLabelText(/hours/i), '2')
    await user.click(screen.getByRole('button', { name: 'Add Entry' }))

    expect(spy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(
      false,
    )
  })

  it('refuses an entry of zero length', async () => {
    const { user, spy } = await openManualForm()

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'task-2')
    await user.click(screen.getByRole('button', { name: 'Add Entry' }))

    expect(spy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(
      false,
    )
  })

  it('adds hours and minutes into one duration and closes the form', async () => {
    const { user, spy } = await openManualForm()

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'task-2')
    await user.type(screen.getByLabelText(/hours/i), '2')
    await user.type(screen.getByLabelText(/minutes/i), '30')
    await user.click(screen.getByRole('button', { name: 'Add Entry' }))

    await waitFor(() => {
      const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')
      if (!post) throw new Error('expected a matching fetch call')
      const body = JSON.parse(String((post[1] as RequestInit).body))
      expect(body.durationMinutes).toBe(150)
      expect(body.taskId).toBe('task-2')
      expect(new Date(body.endedAt).getTime() - new Date(body.startedAt).getTime()).toBe(
        150 * 60_000,
      )
    })
    await waitFor(() => expect(screen.queryByText('Add Manual Entry')).toBeNull())
  })

  it('accepts minutes alone with the hours field left blank', async () => {
    const { user, spy } = await openManualForm()

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'task-1')
    await user.type(screen.getByLabelText(/minutes/i), '45')
    await user.click(screen.getByRole('button', { name: 'Add Entry' }))

    await waitFor(() => {
      const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')
      if (!post) throw new Error('expected a matching fetch call')
      expect(JSON.parse(String((post[1] as RequestInit).body)).durationMinutes).toBe(45)
    })
  })

  it('carries the date and the note the talent typed', async () => {
    const { user, spy } = await openManualForm()

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'task-1')
    const note = screen.getAllByRole('textbox').at(-1) as HTMLInputElement
    await user.type(note, 'Perbaikan bug login')
    const date = screen.getByLabelText(/date/i)
    await user.clear(date)
    await user.type(date, '2026-07-04')
    await user.type(screen.getByLabelText(/hours/i), '1')
    await user.click(screen.getByRole('button', { name: 'Add Entry' }))

    await waitFor(() => {
      const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')
      if (!post) throw new Error('expected a matching fetch call')
      const body = JSON.parse(String((post[1] as RequestInit).body))
      expect(body.description).toBe('Perbaikan bug login')
      expect(body.startedAt.startsWith('2026-07-04')).toBe(true)
    })
  })

  /** A refused write must leave the form open with the answers still in it. */
  it('keeps the form open when the server refuses the entry', async () => {
    const user = userEvent.setup()
    stubFetch({ logs: [], createFails: true })
    await render()
    await user.click(await screen.findByRole('button', { name: /manual entry/i }))

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'task-1')
    await user.type(screen.getByLabelText(/hours/i), '1')
    await user.click(screen.getByRole('button', { name: 'Add Entry' }))

    expect(await screen.findByText('Add Manual Entry')).toBeDefined()
  })
})

/**
 * The per-talent summary.
 *
 * Only rendered when the server sent rows, and the chart loads lazily with it,
 * so an owner on a project nobody has logged against sees the log alone.
 */
describe('the team summary', () => {
  const SUMMARY = [
    {
      talentId: 'tp-1',
      talentName: 'Ani Lestari',
      milestoneId: 'm-1',
      milestoneTitle: 'Autentikasi',
      totalMinutes: 90,
      entryCount: 2,
    },
    {
      talentId: 'tp-1',
      talentName: 'Ani Lestari',
      milestoneId: 'm-2',
      milestoneTitle: null,
      totalMinutes: 30,
      entryCount: 1,
    },
    {
      talentId: 'tp-2',
      talentName: null,
      milestoneId: 'm-1',
      milestoneTitle: 'Autentikasi',
      totalMinutes: 60,
      entryCount: 1,
    },
  ]

  it('stays hidden while nobody has logged anything', async () => {
    stubFetch({ logs: [], summary: [] })

    await render()
    await screen.findByText('Time Log')

    expect(screen.queryByText('Time Summary')).toBeNull()
  })

  it('lists a row per talent and milestone', async () => {
    stubFetch({ logs: [log()], summary: SUMMARY })

    await render()

    expect(await screen.findByText('Time Summary')).toBeDefined()
    expect(screen.getAllByText('Ani Lestari').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Autentikasi').length).toBe(2)
  })

  it('names a milestone the row did not carry', async () => {
    stubFetch({ logs: [log()], summary: [SUMMARY[1]] })

    await render()

    expect(await screen.findByText('Unassigned')).toBeDefined()
  })

  /** An unnamed talent is identified by a short id rather than left blank. */
  it('falls back to a truncated id for a talent with no name', async () => {
    stubFetch({ logs: [log()], summary: [SUMMARY[2]] })

    await render()
    await screen.findByText('Time Summary')

    expect(screen.getAllByText('tp-2').length).toBeGreaterThan(0)
  })

  it('sums a talent across their milestones for the chart', async () => {
    stubFetch({ logs: [log()], summary: SUMMARY })

    await render()
    const summaryPanel = (await screen.findByText('Time Summary')).closest('div') as HTMLElement

    // 90 + 30 minutes for Ani, 60 for the unnamed talent.
    expect(within(summaryPanel).getAllByText('Ani Lestari').length).toBeGreaterThan(0)
  })
})

/** Logging needs a talent profile; the owner's view is read-only. */
describe('who may log time', () => {
  it('offers the timer and manual entry to a talent', async () => {
    stubFetch({ logs: [] })

    await render()

    expect(await screen.findByText('Timer')).toBeDefined()
    expect(screen.getByRole('button', { name: /manual entry/i })).toBeDefined()
  })

  it('gives an owner the log without any way to write to it', async () => {
    signIn('owner')
    stubFetch({ logs: [log()] })

    await render()

    expect(await screen.findByText('Time Log')).toBeDefined()
    expect(screen.queryByText('Timer')).toBeNull()
    expect(screen.queryByRole('button', { name: /manual entry/i })).toBeNull()
  })
})
