// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { Route } from './dashboard'

/**
 * The dashboard is where an operator reads the platform's headline numbers,
 * and most of them are derived here rather than by the API: total projects is
 * a sum over the status map, active is two statuses added together, and
 * utilisation is a ratio multiplied out. A derivation error is a wrong figure
 * with nothing to compare it against.
 *
 * The five charts are deferred to a lazy recharts chunk and render nothing
 * measurable at zero width under jsdom, so what is asserted here is the
 * figures and the states around the charts, not the charts.
 */

const DATA = {
  projects: {
    draft: 4,
    scoping: 2,
    in_progress: 9,
    review: 3,
    completed: 21,
    disputed: 2,
  },
  revenue: {
    totalRevenue: 2_500_000_000,
    breakdown: {
      brd_payment: { amount: 15_000_000, count: 30 },
      prd_payment: { amount: 35_000_000, count: 12 },
      escrow_in: { amount: 400_000_000, count: 44 },
    },
  },
  dailyRevenue: [
    {
      date: '2026-07-24',
      brdRevenue: 150_000,
      prdRevenue: 350_000,
      marginRevenue: 2_500_000,
      revisionFee: 0,
      totalRevenue: 3_000_000,
    },
  ],
  talents: {
    totalTalents: 88,
    tierDistribution: { junior: 40, mid: 30, senior: 18 },
    activeTalents: 22,
    utilizationRate: 0.25,
    averageRating: 4.32,
  },
  aiUsage: {
    totalCostUsd: 0.0421,
    totalRequests: 4650,
    avgTokensPerSuccess: 65_100,
    dailyCost: [{ date: '2026-07-24', costUsd: 0.0421, requests: 15, tokens: 65_100 }],
    byModel: [
      {
        model: 'gemini-2.5-flash',
        requests: 4650,
        promptTokens: 1_200_000,
        completionTokens: 300_000,
        costUsd: 0.0421,
      },
    ],
  },
}

function stubFetch(options: { data?: unknown; fails?: boolean; hang?: boolean } = {}) {
  const spy = vi.fn(async () => {
    if (options.hang) return new Promise(() => {}) as never
    if (options.fails) {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: { code: 'ADMIN_DASHBOARD_FAILED', message: 'Kueri dashboard gagal' },
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: options.data ?? DATA }),
    }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

async function renderPage() {
  const lazy = Route.options.component as unknown as { preload: () => Promise<unknown> }
  await lazy.preload()
  const Component = Route.options.component as () => React.ReactNode
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboard states', () => {
  it('shows a spinner rather than zeroed cards while loading', async () => {
    stubFetch({ hang: true })
    await renderPage()

    expect(screen.queryByText('Total Proyek')).toBeNull()
  })

  /** A failed dashboard must say so; zeroed metrics would read as a dead platform. */
  it('reports the failure with its reason and a way back', async () => {
    stubFetch({ fails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data dashboard')).toBeDefined()
    expect(screen.getByText('Kueri dashboard gagal')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeDefined()
  })
})

describe('headline metrics', () => {
  it('sums every project status into the total', async () => {
    stubFetch()
    await renderPage()

    // 4 + 2 + 9 + 3 + 21 + 2
    expect(await screen.findByText('41')).toBeDefined()
  })

  it('counts in_progress and review together as active', async () => {
    stubFetch()
    await renderPage()

    // 9 + 3, and separately 21 completed.
    expect(await screen.findByText('12 aktif')).toBeDefined()
    expect(screen.getByText('21 proyek selesai')).toBeDefined()
  })

  it('renders total revenue as compact Rupiah', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Rp 2.500 jt')).toBeDefined()
  })

  it('breaks revenue down by stream under the trend', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('Rp 15 jt')).toBeDefined()
    expect(screen.getByText('Rp 35 jt')).toBeDefined()
    expect(screen.getByText('Rp 400 jt')).toBeDefined()
  })

  it('falls back to zero for a revenue stream the period has none of', async () => {
    stubFetch({ data: { ...DATA, revenue: { totalRevenue: 0, breakdown: {} } } })
    await renderPage()

    expect((await screen.findAllByText('Rp 0')).length).toBeGreaterThanOrEqual(4)
  })

  it('reports talents, disputes, utilisation and average rating', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('88')).toBeDefined()
    expect(screen.getByText('22 aktif')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
    // 0.25 as a whole-number percentage.
    expect(screen.getByText('25%')).toBeDefined()
    expect(screen.getByText('4.3/5')).toBeDefined()
  })

  it('reads a missing status as zero rather than NaN', async () => {
    stubFetch({ data: { ...DATA, projects: { completed: 5 } } })
    await renderPage()

    expect(await screen.findByText('5')).toBeDefined()
    expect(screen.getByText('0 aktif')).toBeDefined()
    expect(screen.queryByText('NaN')).toBeNull()
  })
})

describe('AI spend panel', () => {
  /**
   * A scoping turn on gemini-2.5-flash costs about $0.0008. Rendering that
   * through a two-decimal formatter would report the platform's AI bill as
   * zero until it crossed a cent a day.
   */
  it('renders sub-cent spend at a precision that is not zero', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findAllByText('$0.042')).toBeDefined()
  })

  it('never renders a real cost as nothing', async () => {
    stubFetch({ data: { ...DATA, aiUsage: { ...DATA.aiUsage, totalCostUsd: 0.0008 } } })
    await renderPage()

    expect(await screen.findByText('$0.0008')).toBeDefined()
  })

  it('compacts the request and token counts', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findAllByText('4.7K')).toBeDefined()
    expect(screen.getByText('65.1K')).toBeDefined()
  })

  it('lists spend per model with its token split', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText('gemini-2.5-flash')).toBeDefined()
    expect(screen.getByText('1.2M / 300K')).toBeDefined()
  })

  /** An absent aiUsage block must read as no data, not as a broken panel. */
  it('reads as empty rather than broken when the API sends no AI usage', async () => {
    stubFetch({ data: { ...DATA, aiUsage: undefined } })
    await renderPage()

    expect((await screen.findAllByText('Tidak ada data')).length).toBeGreaterThan(0)
    expect(screen.getByText('$0')).toBeDefined()
  })

  it('reads as empty when the model breakdown is present but empty', async () => {
    stubFetch({ data: { ...DATA, aiUsage: { ...DATA.aiUsage, byModel: [], dailyCost: [] } } })
    await renderPage()

    expect((await screen.findAllByText('Tidak ada data')).length).toBeGreaterThanOrEqual(2)
  })
})

describe('chart data states', () => {
  it('reads the tier chart as empty when no tier has anybody in it', async () => {
    stubFetch({ data: { ...DATA, talents: { ...DATA.talents, tierDistribution: {} } } })
    await renderPage()

    expect((await screen.findAllByText('Belum ada data tier')).length).toBe(1)
  })

  it('drops statuses with no projects from the distribution', async () => {
    stubFetch({ data: { ...DATA, projects: {} } })
    await renderPage()

    // Funnel keeps its fixed order and zero-fills; the pie has nothing to show.
    expect((await screen.findAllByText('Tidak ada data')).length).toBeGreaterThan(0)
  })
})
