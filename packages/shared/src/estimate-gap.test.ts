import { describe, expect, it } from 'vitest'
import { budgetGap, timelineGap } from './estimate-gap'

/**
 * The owner's question at the decision point: does what I asked for and what
 * this document says line up, and if not, by how much.
 */

describe('budget against the owner ceiling', () => {
  it('fits when the whole estimated range sits under the ceiling', () => {
    expect(budgetGap(20_000_000, 12_000_000, 18_000_000)).toEqual({
      kind: 'fits',
      estimate: 18_000_000,
    })
  })

  it('fits when the estimate lands exactly on the ceiling', () => {
    expect(budgetGap(20_000_000, 15_000_000, 20_000_000).kind).toBe('fits')
  })

  it('reports the shortfall when the estimate goes over', () => {
    expect(budgetGap(20_000_000, 30_000_000, 40_000_000)).toEqual({
      kind: 'over',
      estimate: 40_000_000,
      ceiling: 20_000_000,
      shortfall: 20_000_000,
      lowEndFits: false,
    })
  })

  /**
   * An estimate straddling the ceiling is a different conversation from one
   * entirely above it, and the shortfall alone cannot tell them apart.
   */
  it('says so when only the upper end is out of reach', () => {
    const gap = budgetGap(20_000_000, 18_000_000, 25_000_000)

    expect(gap).toMatchObject({ kind: 'over', shortfall: 5_000_000, lowEndFits: true })
  })

  /**
   * Documents written before these fields existed normalise to zero, and a PRD
   * defaults them. Zero is not a free project.
   */
  it('cannot compare against an estimate of zero', () => {
    expect(budgetGap(20_000_000, 0, 0)).toEqual({ kind: 'unknown' })
  })

  it('cannot compare when the owner never stated a ceiling', () => {
    expect(budgetGap(0, 10_000_000, 15_000_000)).toEqual({ kind: 'unknown' })
  })

  it('treats a negative ceiling as no answer rather than a limit', () => {
    expect(budgetGap(-1, 10_000_000, 15_000_000)).toEqual({ kind: 'unknown' })
  })

  it('does not claim the low end fits when there is no low end', () => {
    expect(budgetGap(20_000_000, 0, 25_000_000)).toMatchObject({ lowEndFits: false })
  })
})

describe('timeline against the days the owner allowed', () => {
  it('fits when the document needs no longer than the owner allowed', () => {
    expect(timelineGap(90, 75)).toEqual({ kind: 'fits', estimate: 75 })
  })

  it('reports the overrun in days', () => {
    expect(timelineGap(90, 120)).toEqual({
      kind: 'over',
      estimate: 120,
      ceiling: 90,
      shortfall: 30,
      lowEndFits: false,
    })
  })

  it('cannot compare against an estimate of zero days', () => {
    expect(timelineGap(90, 0)).toEqual({ kind: 'unknown' })
  })

  it('cannot compare when the owner gave no timeline', () => {
    expect(timelineGap(0, 120)).toEqual({ kind: 'unknown' })
  })
})
