// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { MatchingSlaBanner, splitDuration } from './matching-sla-banner'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const NOW = new Date('2026-08-13T12:00:00.000Z')

function stubLogs(logs: { toStatus: string; createdAt: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: logs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
}

async function renderBanner(status: string, teamSize: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={client}>
      <MatchingSlaBanner projectId="p-1" status={status} teamSize={teamSize} />
    </QueryClientProvider>,
  )
  // Let the status-log query settle before asserting on what rendered.
  await vi.waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  return result
}

describe('splitDuration', () => {
  it('splits a span into whole days, hours and minutes', () => {
    expect(splitDuration(2 * DAY + 3 * HOUR + 4 * MINUTE)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
    })
  })

  it('reports zeroes for an exhausted span', () => {
    expect(splitDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 })
  })

  /**
   * Callers pass the absolute value so a breach reads "overdue by 3 hours".
   * Clamping here is the second guard: a negative span would otherwise floor
   * to negative days and render a countdown running backwards.
   */
  it('clamps a negative span to zero rather than counting backwards', () => {
    expect(splitDuration(-5 * HOUR)).toEqual({ days: 0, hours: 0, minutes: 0 })
  })

  it('drops the seconds rather than rounding a minute up', () => {
    expect(splitDuration(59 * 1000)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(splitDuration(119 * 1000)).toEqual({ days: 0, hours: 0, minutes: 1 })
  })
})

describe('MatchingSlaBanner', () => {
  describe('when it renders at all', () => {
    it.each(['matching', 'team_forming'])('renders while the project is %s', async (status) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([{ toStatus: status, createdAt: '2026-08-13T00:00:00.000Z' }])

      await renderBanner(status, 1)

      expect(screen.getByText(/Pencocokan akan selesai dalam/)).toBeDefined()
    })

    /**
     * Outside matching there is no promise to count against, and the hook is
     * disabled with it, so the banner must not fire a request either.
     */
    it.each(['draft', 'in_progress', 'completed'])(
      'renders nothing while the project is %s',
      async (status) => {
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)

        const { container } = await renderBanner(status, 1)

        expect(container.firstChild).toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
      },
    )

    /**
     * A project seeded straight into matching has no log entry for it, so
     * there is no start to count from. Rendering nothing beats rendering a
     * deadline computed off an epoch of zero.
     */
    it('renders nothing when the status log never entered matching', async () => {
      stubLogs([{ toStatus: 'prd_approved', createdAt: '2026-08-13T00:00:00.000Z' }])

      const { container } = await renderBanner('matching', 1)

      expect(container.firstChild).toBeNull()
    })

    it('renders nothing while the status log is still loading', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { container } = render(
        <QueryClientProvider client={client}>
          <MatchingSlaBanner projectId="p-1" status="matching" teamSize={1} />
        </QueryClientProvider>,
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('the countdown', () => {
    /**
     * The product promises 72 hours for one talent. Entering matching 12 hours
     * ago leaves 60, which is the figure the owner is holding the platform to.
     */
    it('counts a single-talent project down from 72 hours', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([{ toStatus: 'matching', createdAt: '2026-08-13T00:00:00.000Z' }])

      const { container } = await renderBanner('matching', 1)

      // 60 hours left, rendered as whole days plus hours.
      expect(container.textContent).toContain('2 hari 12 jam')
    })

    /**
     * Team size decides the window, not the status: a team project sits in
     * `matching` before it reaches `team_forming` and gets 14 days from the
     * start. Reading the window off the status would give it 72 hours.
     */
    it('counts a team project down from 14 days even while still in matching', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([{ toStatus: 'matching', createdAt: '2026-08-13T00:00:00.000Z' }])

      const { container } = await renderBanner('matching', 3)

      // 14 days minus the 12 hours already elapsed.
      expect(container.textContent).toContain('13 hari 12 jam')
    })

    it('names the deadline as well as the time left', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([{ toStatus: 'matching', createdAt: '2026-08-13T00:00:00.000Z' }])

      const { container } = await renderBanner('matching', 1)

      expect(container.textContent).toContain('2026')
    })

    /**
     * A project that dropped out of matching and came back gets a fresh
     * window, so the most recent entry wins rather than the first.
     */
    it('starts the clock from the most recent entry into matching', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([
        { toStatus: 'matching', createdAt: '2026-08-01T00:00:00.000Z' },
        { toStatus: 'matching', createdAt: '2026-08-13T06:00:00.000Z' },
      ])

      const { container } = await renderBanner('matching', 1)

      // Six hours in, so 66 left rather than the long-since-breached first try.
      expect(container.textContent).toContain('2 hari 18 jam')
      expect(container.textContent).not.toContain('melewati batas waktu')
    })
  })

  describe('once the promise is late', () => {
    it('says so instead of counting on', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([{ toStatus: 'matching', createdAt: '2026-08-01T00:00:00.000Z' }])

      const { container } = await renderBanner('matching', 1)

      expect(container.querySelector('.border-accent-coral-500\\/30')).not.toBeNull()
    })

    /**
     * The overdue span is passed through as an absolute value, so a breach
     * reads "overdue by 9 days" rather than "-9 days".
     */
    it('reports the overrun as a positive span', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
      stubLogs([{ toStatus: 'matching', createdAt: '2026-08-01T00:00:00.000Z' }])

      const { container } = await renderBanner('matching', 1)

      expect(container.textContent).not.toContain('-')
    })
  })
})
