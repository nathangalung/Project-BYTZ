import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const paymentsSource = readSource('./_authenticated/payments/index.tsx')

/**
 * The payments page only ever showed Total Spent, which is always zero for a
 * talent because the sum keys off owner projects, and dropped totalEarned
 * entirely, so a talent's earnings appeared nowhere. It also had no error
 * state, so a failed fetch read as an empty history.
 */
describe('payments page reflects the viewer role', () => {
  it('shows earnings to a talent', () => {
    expect(paymentsSource).toContain("role === 'talent'")
    expect(paymentsSource).toContain('total_earned')
  })

  it('handles a failed history fetch instead of showing an empty list', () => {
    expect(paymentsSource).toContain('historyError')
  })
})
