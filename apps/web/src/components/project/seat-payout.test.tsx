// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { SeatPayout } from './seat-payout'

/**
 * The card quotes the seat, so the two states that matter are "there is work
 * to take and it pays this" and "there is nothing to take". A range collapsed
 * to one figure is the single-seat project, which is most of them.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('SeatPayout', () => {
  it('prints a range when open seats pay differently', () => {
    render(<SeatPayout payoutMin={8_342_647} payoutMax={12_035_294} openPositions={2} />)

    expect(screen.getByText(/Rp\s?8\.342\.647 - Rp\s?12\.035\.294/)).toBeDefined()
  })

  it('prints one figure when every open seat pays the same', () => {
    render(<SeatPayout payoutMin={18_025_000} payoutMax={18_025_000} openPositions={1} />)

    const quoted = screen.getByText(/Rp\s?18\.025\.000/)
    expect(quoted.textContent).not.toContain('-')
  })

  it('says there is nothing open rather than quoting zero', () => {
    render(<SeatPayout payoutMin={null} payoutMax={null} openPositions={0} />)

    expect(screen.getByText(/No open positions/)).toBeDefined()
  })

  /**
   * A count without amounts, or amounts without a count, is a half-answered row
   * from the join. Quoting either half invents a number.
   */
  it('refuses to quote when the count and the amounts disagree', () => {
    render(<SeatPayout payoutMin={null} payoutMax={null} openPositions={3} />)

    expect(screen.getByText(/No open positions/)).toBeDefined()
  })
})
