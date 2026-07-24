import { describe, expect, it } from 'vitest'
import { revisionGate } from './documents'

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
