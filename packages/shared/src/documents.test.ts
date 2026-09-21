import { describe, expect, it } from 'vitest'
import { canGeneratePrd, PRD_GENERATION_STATUSES, revisionGate } from './documents'

// The free limit an unpaid BRD/PRD uses (initial make plus two revisions).
const FREE = 3

describe('revisionGate ladder', () => {
  it('allows the two free revisions on an unpaid document', () => {
    expect(revisionGate(1, false, FREE)).toBe('ok') // first revision
    expect(revisionGate(2, false, FREE)).toBe('ok') // second revision
  })

  it('asks an unpaid document to pay once the free limit is reached', () => {
    expect(revisionGate(3, false, FREE)).toBe('pay_to_unlock')
  })

  it('lifts the cap to nine once paid', () => {
    // The same version 3 that was a paywall unpaid is fine once paid.
    expect(revisionGate(3, true, FREE)).toBe('ok')
    expect(revisionGate(8, true, FREE)).toBe('ok')
  })

  it('hard-stops a paid document at nine, never routing back to payment', () => {
    // The bug this guards: a paid doc at the cap must not ask to pay again.
    expect(revisionGate(9, true, FREE)).toBe('max_reached')
    expect(revisionGate(10, true, FREE)).toBe('max_reached')
  })
})

/**
 * A PRD is written FROM the BRD, so the BRD has to be approved first. The rule
 * it replaces was "is there a BRD row at all", which let a document still
 * sitting in review be walked past, and let a project with no BRD produce a
 * PRD generated from an empty object.
 */
describe('canGeneratePrd', () => {
  it('refuses every status that still owes a BRD approval', () => {
    expect(canGeneratePrd('draft')).toBe(false)
    expect(canGeneratePrd('scoping')).toBe(false)
    // Generated is not approved: this is the gap the status check closes.
    expect(canGeneratePrd('brd_generated')).toBe(false)
  })

  it('allows the first generation once the BRD is approved', () => {
    expect(canGeneratePrd('brd_approved')).toBe(true)
  })

  /** Buying the BRD is a way forward, not a dead end: the PRD is still free. */
  it('allows a purchased BRD to continue to the PRD', () => {
    expect(canGeneratePrd('brd_purchased')).toBe(true)
  })

  it('still allows regenerating a PRD the project already has', () => {
    expect(canGeneratePrd('prd_generated')).toBe(true)
    expect(canGeneratePrd('prd_approved')).toBe(true)
    expect(canGeneratePrd('prd_purchased')).toBe(true)
  })

  // The work is being staffed against the PRD by then; rewriting it there is a
  // different problem than this gate, and not one it silently opens.
  it('refuses once the project has moved on to staffing', () => {
    expect(canGeneratePrd('matching')).toBe(false)
    expect(canGeneratePrd('in_progress')).toBe(false)
    expect(canGeneratePrd('completed')).toBe(false)
    expect(canGeneratePrd('cancelled')).toBe(false)
  })

  it('treats a project whose status could not be read as not allowed', () => {
    expect(canGeneratePrd(undefined)).toBe(false)
    expect(canGeneratePrd(null)).toBe(false)
  })

  it('lists exactly the statuses it allows', () => {
    expect([...PRD_GENERATION_STATUSES]).toEqual([
      'brd_approved',
      'brd_purchased',
      'prd_generated',
      'prd_approved',
      'prd_purchased',
    ])
  })
})
