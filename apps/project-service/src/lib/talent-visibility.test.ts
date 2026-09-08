import { describe, expect, it } from 'vitest'
import {
  isInternalTalentColumn,
  maskPayoutAccount,
  normalisePayoutAccount,
  PUBLIC_TALENT_COLUMNS,
} from './talent-visibility'

describe('the payout destination', () => {
  it('is withheld from the anonymity allowlist', () => {
    for (const column of [
      'payoutChannel',
      'payoutProvider',
      'payoutAccountNumber',
      'payoutAccountHolderName',
      'payoutVerifiedAt',
    ]) {
      expect(Object.keys(PUBLIC_TALENT_COLUMNS)).not.toContain(column)
      expect(isInternalTalentColumn(column)).toBe(true)
    }
  })

  it('never leaves the process as a whole account number', () => {
    const masked = maskPayoutAccount({ id: 't1', payoutAccountNumber: '1234567890' })
    expect(masked).not.toHaveProperty('payoutAccountNumber')
    expect(masked.payoutAccountLast4).toBe('7890')
    expect(masked.id).toBe('t1')
  })

  it('reports no last four when there is no account on file', () => {
    expect(maskPayoutAccount({ payoutAccountNumber: null }).payoutAccountLast4).toBeNull()
    expect(maskPayoutAccount({}).payoutAccountLast4).toBeNull()
  })

  // A number this short is not a real account, and slicing it would echo the
  // whole thing back under a name that promises it did not.
  it('reports no last four for a number shorter than four digits', () => {
    expect(maskPayoutAccount({ payoutAccountNumber: '123' }).payoutAccountLast4).toBeNull()
  })
})

describe('normalising an e-wallet number', () => {
  it.each([
    ['08123456789', '628123456789'],
    ['628123456789', '628123456789'],
    ['+628123456789', '628123456789'],
  ])('stores %s as %s', (given, want) => {
    expect(normalisePayoutAccount('ewallet', given)).toBe(want)
  })

  it('leaves a bank account exactly as given', () => {
    expect(normalisePayoutAccount('bank', '0812345678')).toBe('0812345678')
  })
})
