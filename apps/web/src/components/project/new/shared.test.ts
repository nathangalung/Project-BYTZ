import { ProjectVisibility } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import {
  buildCreateProjectPayload,
  type FormData,
  formatBudgetInput,
  parseBudget,
  step1Schema,
  step2Schema,
} from './shared'

function form(overrides: Partial<FormData> = {}): FormData {
  return {
    title: 'Toko online',
    description: 'Marketplace untuk UMKM lokal',
    category: 'web_app',
    budgetMin: '10.000.000',
    budgetMax: '20.000.000',
    estimatedTimelineDays: '60',
    deadline: '',
    almamater: '',
    minExperience: '',
    requiredSkills: [],
    visibility: ProjectVisibility.PUBLIC_SUMMARY,
    documentFileKey: '',
    documentType: '',
    ...overrides,
  }
}

describe('parseBudget', () => {
  /**
   * The field is typed with Indonesian thousands separators, so the digits
   * have to survive the dots. Number('10.000.000') is NaN, which is how a
   * budget silently became zero.
   */
  it('strips the thousands separators', () => {
    expect(parseBudget('10.000.000')).toBe(10_000_000)
  })

  it('accepts a plain number', () => {
    expect(parseBudget('5000000')).toBe(5_000_000)
  })

  it('reads through a currency prefix', () => {
    expect(parseBudget('Rp 2.500.000')).toBe(2_500_000)
  })

  it('falls back to zero rather than NaN on empty input', () => {
    expect(parseBudget('')).toBe(0)
    expect(parseBudget('abc')).toBe(0)
  })
})

describe('formatBudgetInput', () => {
  it('groups digits the Indonesian way as they are typed', () => {
    expect(formatBudgetInput('10000000')).toBe('10.000.000')
  })

  it('leaves an empty field empty rather than showing a zero', () => {
    expect(formatBudgetInput('')).toBe('')
    expect(formatBudgetInput('Rp')).toBe('')
  })

  it('drops anything that is not a digit', () => {
    expect(formatBudgetInput('Rp 1.234abc')).toBe('1.234')
  })

  it('round-trips with parseBudget', () => {
    expect(parseBudget(formatBudgetInput('987654321'))).toBe(987_654_321)
  })

  it('does not group a value below a thousand', () => {
    expect(formatBudgetInput('500')).toBe('500')
  })
})

describe('buildCreateProjectPayload', () => {
  it('sends the budget as a number, not the typed string', () => {
    const payload = buildCreateProjectPayload(form())

    expect(payload.budgetMin).toBe(10_000_000)
    expect(payload.budgetMax).toBe(20_000_000)
    expect(payload.estimatedTimelineDays).toBe(60)
  })

  /**
   * An empty preferences object would be sent as `{}` and stored, which reads
   * downstream as "the owner asked for nothing" rather than "the owner did not
   * answer". Omitting the key is what keeps those distinct.
   */
  it('omits preferences entirely when none were given', () => {
    expect(buildCreateProjectPayload(form()).preferences).toBeUndefined()
  })

  it('carries only the preferences that were filled in', () => {
    const payload = buildCreateProjectPayload(form({ almamater: 'ITB' }))

    expect(payload.preferences).toEqual({ almamater: 'ITB' })
  })

  it('sends the minimum experience as a number', () => {
    const payload = buildCreateProjectPayload(form({ minExperience: '3' }))

    expect(payload.preferences).toEqual({ minExperience: 3 })
  })

  it('sends required skills only when there are some', () => {
    const withSkills = buildCreateProjectPayload(form({ requiredSkills: ['React', 'Go'] }))
    const without = buildCreateProjectPayload(form({ requiredSkills: [] }))

    expect(withSkills.preferences).toEqual({ requiredSkills: ['React', 'Go'] })
    expect(without.preferences).toBeUndefined()
  })

  describe('company owner details', () => {
    it('carries them for a company project', () => {
      const payload = buildCreateProjectPayload(form(), {
        projectType: 'company',
        companyName: 'PT Maju',
        companyRole: 'CTO',
      })

      expect(payload.preferences).toEqual({ companyName: 'PT Maju', companyRole: 'CTO' })
    })

    it('drops them for an individual project even when filled in', () => {
      const payload = buildCreateProjectPayload(form(), {
        projectType: 'individual',
        companyName: 'PT Maju',
        companyRole: 'CTO',
      })

      expect(payload.preferences).toBeUndefined()
    })

    it('trims the values rather than sending padded ones', () => {
      const payload = buildCreateProjectPayload(form(), {
        projectType: 'company',
        companyName: '  PT Maju  ',
        companyRole: '  CTO  ',
      })

      expect(payload.preferences).toEqual({ companyName: 'PT Maju', companyRole: 'CTO' })
    })

    it('treats a whitespace-only company name as unfilled', () => {
      const payload = buildCreateProjectPayload(form(), {
        projectType: 'company',
        companyName: '   ',
        companyRole: '',
      })

      expect(payload.preferences).toBeUndefined()
    })
  })

  it('carries the visibility the owner chose', () => {
    const payload = buildCreateProjectPayload(form({ visibility: ProjectVisibility.PRIVATE }))

    expect(payload.visibility).toBe(ProjectVisibility.PRIVATE)
  })
})

describe('step1Schema', () => {
  it('accepts a filled-in first step', () => {
    expect(
      step1Schema.safeParse({
        title: 'Toko online',
        description: 'Marketplace untuk UMKM',
        category: 'web_app',
      }).success,
    ).toBe(true)
  })

  it('rejects a title too short to search on', () => {
    expect(
      step1Schema.safeParse({ title: 'ab', description: 'x'.repeat(10), category: 'web_app' })
        .success,
    ).toBe(false)
  })

  it('rejects a description too short to scope from', () => {
    expect(
      step1Schema.safeParse({ title: 'Toko', description: 'pendek', category: 'web_app' }).success,
    ).toBe(false)
  })

  it('rejects a category outside the five the platform serves', () => {
    expect(
      step1Schema.safeParse({
        title: 'Jembatan',
        description: 'Perancangan struktur jembatan',
        category: 'civil_engineering',
      }).success,
    ).toBe(false)
  })
})

describe('step2Schema', () => {
  it('accepts separated budget strings', () => {
    expect(
      step2Schema.safeParse({
        budgetMin: '10.000.000',
        budgetMax: '20.000.000',
        estimatedTimelineDays: '60',
      }).success,
    ).toBe(true)
  })

  it.each(['budgetMin', 'budgetMax'] as const)('rejects a zero %s', (field) => {
    const input = { budgetMin: '10.000.000', budgetMax: '20.000.000', estimatedTimelineDays: '60' }
    expect(step2Schema.safeParse({ ...input, [field]: '0' }).success).toBe(false)
  })

  it('rejects a zero timeline', () => {
    expect(
      step2Schema.safeParse({
        budgetMin: '10.000.000',
        budgetMax: '20.000.000',
        estimatedTimelineDays: '0',
      }).success,
    ).toBe(false)
  })

  /**
   * The schema checks each field on its own, so a maximum below the minimum
   * passes here. The database CHECK is what catches it, which means the owner
   * finds out from a failed request rather than from the field.
   */
  it('does not compare the two budget bounds', () => {
    expect(
      step2Schema.safeParse({
        budgetMin: '20.000.000',
        budgetMax: '10.000.000',
        estimatedTimelineDays: '60',
      }).success,
    ).toBe(true)
  })
})
