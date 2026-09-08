// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { EstimateGapPanel } from './estimate-gap-panel'

/**
 * The decision point: the owner has a document and is choosing whether to
 * carry on into development. Both numbers already existed on separate pages
 * and the arithmetic between them was left to the owner.
 */

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const fits = {
  ownerBudgetMax: 20_000_000,
  ownerTimelineDays: 90,
  estimatedPriceMin: 12_000_000,
  estimatedPriceMax: 18_000_000,
  estimatedTimelineDays: 75,
}

describe('the estimate held against what the owner asked for', () => {
  it('shows the real number when the estimate fits', () => {
    const { container } = render(<EstimateGapPanel {...fits} />)

    expect(container.textContent).toContain('18.000.000')
    expect(container.textContent).toContain('75')
    expect(screen.queryByText(/bahas selisih/i)).toBeNull()
  })

  it('names the overrun on both dimensions and how much it is', () => {
    const { container } = render(
      <EstimateGapPanel
        {...fits}
        estimatedPriceMin={30_000_000}
        estimatedPriceMax={40_000_000}
        estimatedTimelineDays={120}
      />,
    )

    // 40jt against a 20jt ceiling, and 120 days against 90.
    expect(container.textContent).toContain('20.000.000')
    expect(container.textContent).toContain('30 hari')
    expect(screen.getByText(/bahas selisih/i)).toBeDefined()
  })

  /** Straddling the ceiling is a different conversation from clearing it. */
  it('says when only the upper end of the estimate is out of reach', () => {
    const { container } = render(
      <EstimateGapPanel {...fits} estimatedPriceMin={18_000_000} estimatedPriceMax={25_000_000} />,
    )

    expect(container.textContent).toContain('batas bawahnya masih masuk')
  })

  /**
   * A document written before these fields existed normalises to zero. Zero is
   * not a free project delivered instantly.
   */
  it('says it cannot compare rather than reporting a gap against zero', () => {
    const { container } = render(
      <EstimateGapPanel {...fits} estimatedPriceMin={0} estimatedPriceMax={0} />,
    )

    expect(container.textContent).toContain('Belum bisa dibandingkan')
    expect(container.textContent).not.toContain('Rp 0')
  })

  it('renders nothing when neither dimension can be compared', () => {
    const { container } = render(
      <EstimateGapPanel
        ownerBudgetMax={0}
        ownerTimelineDays={0}
        estimatedPriceMin={0}
        estimatedPriceMax={0}
        estimatedTimelineDays={0}
      />,
    )

    expect(container.textContent).toBe('')
  })

  /** The prompt must not appear next to two estimates that both fit. */
  it('offers no discussion prompt when everything fits', () => {
    render(<EstimateGapPanel {...fits} />)

    expect(screen.queryByText(/bahas selisih/i)).toBeNull()
  })
})
