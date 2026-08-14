// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartCard, ChartEmpty, ChartSkeleton } from './chart-card'

/**
 * The frame and the two non-chart states around every dashboard chart.
 * ChartSkeleton is what the route shows while the recharts chunk loads, and
 * ChartEmpty is what a series that resolved to nothing must read as -- an
 * empty chart area with no message reads as broken.
 */

describe('ChartCard', () => {
  it('renders its title as a heading above the chart', () => {
    render(
      <ChartCard title="Tren Pendapatan">
        <p>grafik</p>
      </ChartCard>,
    )

    expect(screen.getByRole('heading', { name: 'Tren Pendapatan' })).toBeDefined()
    expect(screen.getByText('grafik')).toBeDefined()
  })

  it('appends a caller class without dropping its own', () => {
    const { container } = render(
      <ChartCard title="Tren" className="lg:col-span-2">
        <p>grafik</p>
      </ChartCard>,
    )

    const className = container.firstElementChild?.className ?? ''
    expect(className).toContain('lg:col-span-2')
    expect(className).toContain('rounded-xl')
  })
})

describe('ChartSkeleton', () => {
  it('holds the chart height so the page does not jump when the chunk lands', () => {
    const { container } = render(<ChartSkeleton />)

    expect(container.firstElementChild?.className).toContain('h-[300px]')
  })
})

describe('ChartEmpty', () => {
  it('says why the chart area is blank', () => {
    render(<ChartEmpty message="Belum ada data" />)

    expect(screen.getByText('Belum ada data')).toBeDefined()
  })

  it('reserves the same height as a rendered chart', () => {
    const { container } = render(<ChartEmpty message="Belum ada data" />)

    expect(container.firstElementChild?.className).toContain('h-[300px]')
  })
})
