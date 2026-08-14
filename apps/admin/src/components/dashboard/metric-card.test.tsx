// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricCard, StatTile } from './metric-card'

/**
 * These two tiles are where the dashboard publishes the figures an operator
 * acts on: revenue, escrow held, AI spend. Both take an already-formatted
 * string, so what matters here is that the value they are handed is the value
 * that reaches the page, and that the label stays attached to it.
 */

describe('MetricCard', () => {
  it('renders the label, value and sub-line it is given', () => {
    render(
      <MetricCard
        icon={<span>ikon</span>}
        label="Total Pendapatan"
        value="Rp 125 jt"
        sub="sejak peluncuran"
      />,
    )

    expect(screen.getByText('Total Pendapatan')).toBeDefined()
    expect(screen.getByText('Rp 125 jt')).toBeDefined()
    expect(screen.getByText('sejak peluncuran')).toBeDefined()
    expect(screen.getByText('ikon')).toBeDefined()
  })

  /** A miliar folds to juta rather than gaining an M, and must pass through intact. */
  it('renders a compact Rupiah value character for character', () => {
    render(
      <MetricCard icon={<span />} label="Total Pendapatan" value="Rp 2.500 jt" sub="kumulatif" />,
    )

    expect(screen.getByText('Rp 2.500 jt')).toBeDefined()
  })

  it('renders a trend indicator when one is supplied', () => {
    render(
      <MetricCard
        icon={<span />}
        label="Bulan Ini"
        value="Rp 12 jt"
        sub="vs bulan lalu"
        trend={<span>+20.0%</span>}
      />,
    )

    expect(screen.getByText('+20.0%')).toBeDefined()
  })

  it('omits the trend slot when none is supplied', () => {
    render(<MetricCard icon={<span />} label="Bulan Ini" value="Rp 12 jt" sub="vs bulan lalu" />)

    expect(screen.queryByText('+20.0%')).toBeNull()
  })
})

describe('StatTile', () => {
  it('pairs a small figure with its label', () => {
    render(<StatTile label="Biaya AI" value="$0.0421" />)

    expect(screen.getByText('Biaya AI')).toBeDefined()
    expect(screen.getByText('$0.0421')).toBeDefined()
  })

  /**
   * Sub-cent AI spend is the reason formatUsd widens precision below a dollar.
   * The tile must not be the thing that rounds it back to nothing.
   */
  it('renders a sub-cent figure without truncating it', () => {
    render(<StatTile label="Biaya AI" value="$0.0008" />)

    expect(screen.getByText('$0.0008')).toBeDefined()
  })
})
