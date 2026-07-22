import { ProjectVisibility } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { buildCreateProjectPayload } from './new'

// Visibility was collected then dropped before submit.
const base = {
  title: 'Marketplace revamp',
  description: 'Rebuild the checkout flow',
  category: 'web_app',
  budgetMin: '10000000',
  budgetMax: '25000000',
  estimatedTimelineDays: '60',
  deadline: '',
  almamater: '',
  minExperience: '',
  requiredSkills: [] as string[],
  visibility: ProjectVisibility.PUBLIC_SUMMARY,
  documentFileKey: '',
  documentType: '' as const,
}

describe('buildCreateProjectPayload', () => {
  it('sends the visibility the owner picked', () => {
    for (const visibility of Object.values(ProjectVisibility)) {
      expect(buildCreateProjectPayload({ ...base, visibility }).visibility).toBe(visibility)
    }
  })

  it('does not silently publish a private project', () => {
    const payload = buildCreateProjectPayload({ ...base, visibility: ProjectVisibility.PRIVATE })
    expect(payload.visibility).toBe('private')
    expect(payload.visibility).not.toBe('public_summary')
  })

  it('omits preferences when none were given', () => {
    expect(buildCreateProjectPayload(base).preferences).toBeUndefined()
  })

  it('includes preferences that were given', () => {
    const payload = buildCreateProjectPayload({
      ...base,
      almamater: 'ITB',
      minExperience: '3',
      requiredSkills: ['React', 'Go'],
    })
    expect(payload.preferences).toEqual({
      almamater: 'ITB',
      minExperience: 3,
      requiredSkills: ['React', 'Go'],
    })
  })

  it('sends budgets as numbers', () => {
    const payload = buildCreateProjectPayload(base)
    expect(payload.budgetMin).toBe(10_000_000)
    expect(payload.budgetMax).toBe(25_000_000)
    expect(payload.estimatedTimelineDays).toBe(60)
  })
})
