// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'

/**
 * recharts measures its container, and under jsdom every element is zero by
 * zero, so ResponsiveContainer renders no axis, no bar and no tooltip. Testing
 * the rendered output here would assert an empty <div>.
 *
 * What is worth testing is not recharts but the code this file hands it: the
 * tick and tooltip formatters, and the per-datum colour lookups. Those are
 * ordinary functions that decide whether a figure reads as "$0.042" or "0.042",
 * and whether an unrecognised project status renders as a colour at all. So
 * recharts is replaced with stubs that record the props they were given, and
 * the assertions run against those.
 */

type Recorded = Record<string, unknown>

const recorded: Record<string, Recorded[]> = {}

function record(name: string) {
  return function Stub(props: Recorded) {
    recorded[name] ??= []
    recorded[name].push(props)
    return <div>{props.children as React.ReactNode}</div>
  }
}

vi.mock('recharts', () => ({
  ResponsiveContainer: record('ResponsiveContainer'),
  LineChart: record('LineChart'),
  BarChart: record('BarChart'),
  PieChart: record('PieChart'),
  CartesianGrid: record('CartesianGrid'),
  XAxis: record('XAxis'),
  YAxis: record('YAxis'),
  Tooltip: record('Tooltip'),
  Legend: record('Legend'),
  Line: record('Line'),
  Bar: record('Bar'),
  Pie: record('Pie'),
  Cell: record('Cell'),
}))

const {
  AiCostChart,
  ConversionFunnelChart,
  RevenueTrendChart,
  StatusDistributionChart,
  TierDistributionChart,
} = await import('./charts')

function propsOf(name: string, index = 0): Recorded {
  const entry = recorded[name]?.[index]
  if (!entry) throw new Error(`no ${name} rendered`)
  return entry
}

function fills(): unknown[] {
  return (recorded.Cell ?? []).map((c) => c.fill)
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  for (const key of Object.keys(recorded)) delete recorded[key]
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RevenueTrendChart', () => {
  const DATA = [{ date: '24/7', revenue: 2_500_000_000 }]

  it('plots the series it is given', () => {
    render(<RevenueTrendChart data={DATA} />)

    expect(propsOf('LineChart').data).toBe(DATA)
    expect(propsOf('Line').dataKey).toBe('revenue')
  })

  /** A miliar axis tick folds to juta rather than gaining an M suffix. */
  it('formats axis ticks as compact Rupiah', () => {
    render(<RevenueTrendChart data={DATA} />)

    const format = propsOf('YAxis').tickFormatter as (v: number) => string
    expect(format(2_500_000_000)).toBe('Rp 2.500 jt')
    expect(format(6_000_000)).toBe('Rp 6 jt')
  })

  it('labels the tooltip value as revenue in the active language', () => {
    render(<RevenueTrendChart data={DATA} />)

    const format = propsOf('Tooltip').formatter as (v: unknown) => [string, string]
    expect(format(18_000_000)).toEqual(['Rp 18 jt', 'Revenue'])
  })

  it('coerces a string value before formatting it', () => {
    render(<RevenueTrendChart data={DATA} />)

    const format = propsOf('Tooltip').formatter as (v: unknown) => [string, string]
    expect(format('18000000')[0]).toBe('Rp 18 jt')
  })
})

describe('AiCostChart', () => {
  const DATA = [{ date: '24/7', cost: 0.0421, requests: 15 }]

  it('plots cost as the line', () => {
    render(<AiCostChart data={DATA} />)

    expect(propsOf('LineChart').data).toBe(DATA)
    expect(propsOf('Line').dataKey).toBe('cost')
  })

  /**
   * Sub-cent spend is the norm on glm-5.3. A two-decimal axis would
   * label every tick $0.00 and the trend would look flat at zero.
   */
  it('widens axis precision below a cent', () => {
    render(<AiCostChart data={DATA} />)

    const format = propsOf('YAxis').tickFormatter as (v: number) => string
    expect(format(0.0008)).toBe('$0.0008')
    expect(format(0.0421)).toBe('$0.042')
    expect(format(1.5)).toBe('$1.50')
  })

  /** Two series share one tooltip: money must not render as a bare count. */
  it('formats the cost series as USD and the request series as a count', () => {
    render(<AiCostChart data={DATA} />)

    const format = propsOf('Tooltip').formatter as (v: unknown, n: unknown) => [string, string]
    expect(format(0.0421, 'cost')).toEqual(['$0.042', 'Biaya AI'])
    expect(format(15, 'requests')).toEqual(['15', 'Request'])
  })
})

describe('ConversionFunnelChart', () => {
  it('draws one cell per stage in the order given', () => {
    render(
      <ConversionFunnelChart
        data={[
          { status: 'draft', label: 'Draft', count: 4 },
          { status: 'completed', label: 'Selesai', count: 21 },
        ]}
      />,
    )

    expect(propsOf('Bar').dataKey).toBe('count')
    expect(fills()).toHaveLength(2)
    // draft is the neutral grey, completed the brand green.
    expect(fills()[0]).toBe('#8891a0')
    expect(fills()[1]).toBe('#9fc26e')
  })

  /** An unmapped status must still get a colour rather than a transparent bar. */
  it('falls back to green for a status with no colour of its own', () => {
    render(<ConversionFunnelChart data={[{ status: 'archived', label: 'Arsip', count: 1 }]} />)

    expect(fills()).toEqual(['#9fc26e'])
  })

  it('plots the category axis off the label, not the raw status', () => {
    render(<ConversionFunnelChart data={[{ status: 'draft', label: 'Draft', count: 4 }]} />)

    const category = (recorded.YAxis ?? []).find((p) => p.type === 'category')
    expect(category?.dataKey).toBe('label')
  })
})

describe('TierDistributionChart', () => {
  it('colours each tier distinctly', () => {
    render(
      <TierDistributionChart
        data={[
          { tier: 'Junior', tierKey: 'junior', count: 40 },
          { tier: 'Mid', tierKey: 'mid', count: 30 },
          { tier: 'Senior', tierKey: 'senior', count: 18 },
        ]}
      />,
    )

    expect(fills()).toEqual(['#9fc26e', '#e59a91', '#1d4a54'])
  })

  it('falls back to green for an unrecognised tier', () => {
    render(<TierDistributionChart data={[{ tier: 'Lead', tierKey: 'lead', count: 2 }]} />)

    expect(fills()).toEqual(['#9fc26e'])
  })
})

describe('StatusDistributionChart', () => {
  const DATA = [
    { name: 'Sedang Berjalan', statusKey: 'in_progress', value: 9 },
    { name: 'Dispute', statusKey: 'disputed', value: 2 },
  ]

  it('slices by value and names by label', () => {
    render(<StatusDistributionChart data={DATA} />)

    expect(propsOf('Pie').dataKey).toBe('value')
    expect(propsOf('Pie').nameKey).toBe('name')
  })

  it('writes each slice label as name and count', () => {
    render(<StatusDistributionChart data={DATA} />)

    const label = propsOf('Pie').label as (p: unknown) => string
    expect(label({ name: 'Selesai', value: 21 })).toBe('Selesai: 21')
  })

  /** recharts omits either field on a degenerate slice; neither may print undefined. */
  it('substitutes an empty name and a zero count when either is missing', () => {
    render(<StatusDistributionChart data={DATA} />)

    const label = propsOf('Pie').label as (p: unknown) => string
    expect(label({})).toBe(': 0')
    expect(label({ name: 'Selesai' })).toBe('Selesai: 0')
  })

  it('colours each slice by its status key', () => {
    render(<StatusDistributionChart data={DATA} />)

    expect(fills()).toEqual(['#1d4a54', '#d47367'])
  })
})

/** The pie is keyed on the project status enum, which the console may lag. */
describe('StatusDistributionChart colours', () => {
  it('falls back to green for a status this build does not know', () => {
    render(
      <StatusDistributionChart data={[{ name: 'Diarsipkan', statusKey: 'archived', value: 4 }]} />,
    )

    expect(fills()).toEqual(['#9fc26e'])
  })
})
