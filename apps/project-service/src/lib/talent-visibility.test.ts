import { describe, expect, it } from 'vitest'
import { isInternalTalentColumn, maskBankAccount, PUBLIC_TALENT_COLUMNS } from './talent-visibility'

describe('the payout destination', () => {
  it('is withheld from the anonymity allowlist', () => {
    for (const column of [
      'bankCode',
      'bankAccountNumber',
      'bankAccountHolderName',
      'bankVerifiedAt',
    ]) {
      expect(Object.keys(PUBLIC_TALENT_COLUMNS)).not.toContain(column)
      expect(isInternalTalentColumn(column)).toBe(true)
    }
  })

  it('never leaves the process as a whole account number', () => {
    const masked = maskBankAccount({ id: 't1', bankAccountNumber: '1234567890' })
    expect(masked).not.toHaveProperty('bankAccountNumber')
    expect(masked.bankAccountLast4).toBe('7890')
    expect(masked.id).toBe('t1')
  })

  it('reports no last four when there is no account on file', () => {
    expect(maskBankAccount({ bankAccountNumber: null }).bankAccountLast4).toBeNull()
    expect(maskBankAccount({}).bankAccountLast4).toBeNull()
  })

  // A number this short is not a real account, and slicing it would echo the
  // whole thing back under a name that promises it did not.
  it('reports no last four for a number shorter than four digits', () => {
    expect(maskBankAccount({ bankAccountNumber: '123' }).bankAccountLast4).toBeNull()
  })
})
