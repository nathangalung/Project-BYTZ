import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PLATFORM_FEE_BRACKETS, PLATFORM_FEE_TOP_BRACKET } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const settingsSource = readSource('./_authenticated/settings.tsx')

/**
 * The bracket table has one owner: pricing.ts. The engine reads those
 * constants, the seed copies them into platform_settings, and the admin panel
 * renders the row read-only.
 *
 * The panel also needs a value when the settings row is missing, and that
 * fallback used to be a hand-typed copy of the eight rows. A copy is a second
 * source of truth: change a rate in pricing.ts and the admin table keeps
 * showing the old split to whoever is auditing a payout, with nothing failing.
 * The fallback must be derived from the constants, not retyped.
 */

describe('fee bracket table in admin settings', () => {
  it('derives the fallback from the pricing constants', () => {
    expect(settingsSource).toContain('PLATFORM_FEE_BRACKETS')
    expect(settingsSource).toContain('PLATFORM_FEE_TOP_BRACKET')
    expect(settingsSource).toContain("from '@kerjacus/shared'")
  })

  it('hardcodes no bracket rate of its own', () => {
    const rates = [
      ...PLATFORM_FEE_BRACKETS.flatMap((b) => [b.talentShare, b.feeRate]),
      PLATFORM_FEE_TOP_BRACKET.talentShare,
      PLATFORM_FEE_TOP_BRACKET.feeRate,
    ]
    for (const rate of rates) {
      expect(settingsSource, `rate ${rate} is retyped in the panel`).not.toContain(String(rate))
    }
  })

  it('hardcodes no bracket ceiling of its own', () => {
    for (const bracket of PLATFORM_FEE_BRACKETS) {
      expect(settingsSource).not.toContain(String(bracket.maxFee))
    }
  })
})

describe('published bracket table', () => {
  /**
   * The rates the platform owner locked. Pinned here as well as in
   * pricing.test.ts because this is the table the admin panel publishes.
   */
  it('splits the fee at the eight locked rates', () => {
    expect(PLATFORM_FEE_BRACKETS.map((b) => [b.maxFee, b.talentShare, b.feeRate])).toEqual([
      [3_000_000, 0.815, 0.185],
      [5_000_000, 0.765, 0.235],
      [10_000_000, 0.715, 0.285],
      [15_000_000, 0.665, 0.335],
      [20_000_000, 0.615, 0.385],
      [30_000_000, 0.565, 0.435],
      [50_000_000, 0.515, 0.485],
    ])
    expect(PLATFORM_FEE_TOP_BRACKET).toEqual({ talentShare: 0.465, feeRate: 0.535 })
  })

  it('gives the talent and the platform the whole fee', () => {
    for (const b of [...PLATFORM_FEE_BRACKETS, PLATFORM_FEE_TOP_BRACKET]) {
      expect(b.talentShare + b.feeRate).toBeCloseTo(1, 10)
    }
  })
})
