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
  it('refuses every position that has no BRD yet', () => {
    expect(canGeneratePrd('draft', 'approved')).toBe(false)
    expect(canGeneratePrd('scoping', 'approved')).toBe(false)
  })

  // Generated is not approved: this is the gap the document check closes, and
  // the one the position can no longer see now that brd_review spans both.
  it('refuses a BRD the owner has not approved', () => {
    expect(canGeneratePrd('brd_review', 'draft')).toBe(false)
    expect(canGeneratePrd('brd_review', 'review')).toBe(false)
  })

  it('allows the first generation once the BRD is approved', () => {
    expect(canGeneratePrd('brd_review', 'approved')).toBe(true)
  })

  /**
   * Buying the BRD is a way forward, not a dead end: the PRD is still free.
   * The purchase leaves the document approved and stamps paid_at, so an owner
   * who paid arrives here on the same status as one who only approved - which
   * is why 'paid' no longer has to be spelled out as a second way in.
   */
  it('allows a purchased BRD to continue to the PRD', () => {
    expect(canGeneratePrd('brd_review', 'approved')).toBe(true)
  })

  it('still allows regenerating a PRD the project already has', () => {
    expect(canGeneratePrd('prd_review', 'approved')).toBe(true)
  })

  // The work is being staffed against the PRD by then; rewriting it there is a
  // different problem than this gate, and not one it silently opens.
  it('refuses once the project has moved on to staffing', () => {
    expect(canGeneratePrd('matching', 'approved')).toBe(false)
    expect(canGeneratePrd('in_progress', 'approved')).toBe(false)
    expect(canGeneratePrd('completed', 'approved')).toBe(false)
    expect(canGeneratePrd('cancelled', 'approved')).toBe(false)
  })

  it('treats a project whose status could not be read as not allowed', () => {
    expect(canGeneratePrd(undefined, 'approved')).toBe(false)
    expect(canGeneratePrd(null, 'approved')).toBe(false)
  })

  it('treats a missing BRD as not allowed', () => {
    expect(canGeneratePrd('brd_review', undefined)).toBe(false)
    expect(canGeneratePrd('brd_review', null)).toBe(false)
  })

  it('lists exactly the positions it allows', () => {
    expect([...PRD_GENERATION_STATUSES]).toEqual(['brd_review', 'prd_review'])
  })
})
