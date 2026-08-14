// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { InfoRow, OverviewTab } from './overview-tab'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

type Project = Parameters<typeof OverviewTab>[0]['project']

function project(overrides: Partial<Project> = {}): Project {
  return {
    description: 'Toko online untuk UMKM lokal',
    budgetMin: 10_000_000,
    budgetMax: 50_000_000,
    estimatedTimelineDays: 60,
    teamSize: 3,
    finalPrice: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  }
}

function stubMilestones(statuses: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: statuses.map((status, i) => ({ id: `m-${String(i)}`, status })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  )
}

function renderTab(overrides: Partial<Project> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OverviewTab project={project(overrides)} projectId="p-1" />
    </QueryClientProvider>,
  )
}

describe('OverviewTab', () => {
  it('shows the project description', () => {
    stubMilestones([])
    renderTab()

    expect(screen.getByText('Toko online untuk UMKM lokal')).toBeDefined()
  })

  it('shows the budget range, the timeline and the team size', () => {
    stubMilestones([])
    renderTab()

    expect(screen.getByText('Rp 10.000.000 - Rp 50.000.000')).toBeDefined()
    expect(screen.getByText('60 hari')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
  })

  describe('the milestone progress', () => {
    /**
     * Progress is the share of milestones approved, not the share started, so
     * a project where everything is submitted and nothing accepted reads as
     * zero. That is the honest figure: nothing has been paid out yet.
     */
    it('counts only the approved milestones', async () => {
      stubMilestones(['approved', 'approved', 'submitted', 'pending'])
      renderTab()

      expect(await screen.findByText('2/4')).toBeDefined()
      expect(screen.getByText('50%')).toBeDefined()
    })

    it('rounds rather than truncating', async () => {
      stubMilestones(['approved', 'pending', 'pending'])
      renderTab()

      expect(await screen.findByText('33%')).toBeDefined()
    })

    /**
     * A project with no milestones yet divides by zero. Guarding to 0% is what
     * keeps the tile from rendering NaN before the PRD is broken down.
     */
    it('reads zero rather than NaN before any milestone exists', () => {
      stubMilestones([])
      renderTab()

      expect(screen.getByText('0%')).toBeDefined()
      expect(screen.getByText('0/0')).toBeDefined()
    })

    it('reads a hundred per cent once every milestone is approved', async () => {
      stubMilestones(['approved', 'approved'])
      renderTab()

      expect(await screen.findByText('100%')).toBeDefined()
    })
  })

  describe('the days remaining', () => {
    it('counts down from the timeline against the elapsed days', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'))
      stubMilestones([])
      renderTab({ createdAt: '2026-08-01T00:00:00.000Z', estimatedTimelineDays: 60 })

      expect(screen.getByText('50')).toBeDefined()
    })

    /**
     * An overrun project would otherwise show a negative count, which reads as
     * a countdown running backwards rather than as a deadline already passed.
     */
    it('floors at zero rather than counting negative on an overrun', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
      stubMilestones([])
      renderTab({ createdAt: '2026-08-01T00:00:00.000Z', estimatedTimelineDays: 60 })

      expect(screen.getByText('0')).toBeDefined()
      expect(screen.queryByText(/^-/)).toBeNull()
    })
  })

  describe('the final price', () => {
    it('stays hidden until the PRD has priced the project', () => {
      stubMilestones([])
      renderTab({ finalPrice: null })

      expect(screen.queryByText('Harga Final')).toBeNull()
    })

    it('appears once there is one', () => {
      stubMilestones([])
      renderTab({ finalPrice: 45_000_000 })

      expect(screen.getByText('Harga Final')).toBeDefined()
      expect(screen.getByText('Rp 45.000.000')).toBeDefined()
    })
  })

  it('dates the project from its creation and last update', () => {
    stubMilestones([])
    renderTab()

    expect(screen.getByText('1 Agustus 2026')).toBeDefined()
    expect(screen.getByText('13 Agustus 2026')).toBeDefined()
  })
})

describe('InfoRow', () => {
  it('pairs a label with its value', () => {
    render(<InfoRow icon={<span data-icon="" />} label="Anggaran" value="Rp 1.000" />)

    expect(screen.getByText('Anggaran')).toBeDefined()
    expect(screen.getByText('Rp 1.000')).toBeDefined()
  })

  it('picks out a highlighted value from the ordinary ones', () => {
    render(<InfoRow icon={<span />} label="Harga Final" value="Rp 1.000" highlight />)
    expect(screen.getByText('Rp 1.000').className).toContain('text-success-600')

    render(<InfoRow icon={<span />} label="Anggaran" value="Rp 2.000" />)
    expect(screen.getByText('Rp 2.000').className).toContain('text-primary-600')
  })
})
