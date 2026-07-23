import { AppError } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { applyProjectVisibility, gateProjectPrd, redactBrd } from './visibility'

const LONG_DESCRIPTION = 'x'.repeat(400)

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-001',
    ownerId: 'owner-001',
    title: 'Test Project',
    description: LONG_DESCRIPTION,
    category: 'web_app',
    status: 'in_progress',
    budgetMin: 5_000_000,
    budgetMax: 20_000_000,
    estimatedTimelineDays: 60,
    teamSize: 1,
    visibility: 'public_summary',
    finalPrice: 18_000_000,
    platformFee: 3_600_000,
    talentPayout: 14_400_000,
    preferences: { requiredSkills: ['React'] },
    ...overrides,
  }
}

describe('applyProjectVisibility — owner', () => {
  it('returns the untouched row to the owner, including internal money columns', () => {
    const project = makeProject({ visibility: 'private' })
    const result = applyProjectVisibility(project, 'owner-001')

    expect(result).toEqual(project)
    expect(result.finalPrice).toBe(18_000_000)
    expect(result.platformFee).toBe(3_600_000)
    expect(result.talentPayout).toBe(14_400_000)
    expect(result.description).toBe(LONG_DESCRIPTION)
  })
})

describe('applyProjectVisibility — private', () => {
  it('throws PROJECT_NOT_FOUND for an anonymous viewer', () => {
    const project = makeProject({ visibility: 'private' })
    expect(() => applyProjectVisibility(project, null)).toThrow(AppError)
    expect(() => applyProjectVisibility(project, null)).toThrow('Project not found')
  })

  it('throws PROJECT_NOT_FOUND for a logged-in non-owner', () => {
    const project = makeProject({ visibility: 'private' })
    expect(() => applyProjectVisibility(project, 'someone-else')).toThrow('Project not found')
  })

  it('does not confirm existence via a distinguishable error code', () => {
    const project = makeProject({ visibility: 'private' })
    try {
      applyProjectVisibility(project, null)
      throw new Error('expected applyProjectVisibility to throw')
    } catch (err) {
      expect((err as AppError).code).toBe('PROJECT_NOT_FOUND')
    }
  })
})

describe('applyProjectVisibility — non-owner redaction', () => {
  it('strips internal money columns on public_summary', () => {
    const result = applyProjectVisibility(makeProject({ visibility: 'public_summary' }), null)

    expect(result).not.toHaveProperty('finalPrice')
    expect(result).not.toHaveProperty('platformFee')
    expect(result).not.toHaveProperty('talentPayout')
  })

  it('strips internal money columns on public_detail', () => {
    const result = applyProjectVisibility(makeProject({ visibility: 'public_detail' }), null)

    expect(result).not.toHaveProperty('finalPrice')
    expect(result).not.toHaveProperty('platformFee')
    expect(result).not.toHaveProperty('talentPayout')
  })

  it('truncates description and drops preferences on public_summary', () => {
    const result = applyProjectVisibility(makeProject({ visibility: 'public_summary' }), null)

    expect(result.description).toBe(`${'x'.repeat(120)}...`)
    expect(result.preferences).toBeNull()
  })

  it('keeps full description and preferences on public_detail', () => {
    const result = applyProjectVisibility(makeProject({ visibility: 'public_detail' }), null)

    expect(result.description).toBe(LONG_DESCRIPTION)
    expect(result.preferences).toEqual({ requiredSkills: ['React'] })
  })

  it('keeps non-sensitive fields visible', () => {
    const result = applyProjectVisibility(makeProject({ visibility: 'public_detail' }), null)

    expect(result.id).toBe('proj-001')
    expect(result.title).toBe('Test Project')
    expect(result.budgetMin).toBe(5_000_000)
  })

  it('handles a null description without throwing', () => {
    const result = applyProjectVisibility(
      makeProject({ visibility: 'public_summary', description: null }),
      null,
    )

    expect(result.description).toBeNull()
  })
})

describe('gateProjectPrd', () => {
  const prd = { id: 'prd-1', price: 2_000_000, content: { work_packages: [] } }

  it('gives the owner the PRD', () => {
    expect(gateProjectPrd(prd, 'owner-1', 'owner-1')).toBe(prd)
  })

  it('gives an assigned talent the PRD', () => {
    expect(gateProjectPrd(prd, 'talent-1', 'owner-1', true)).toBe(prd)
  })

  it('withholds the PRD from an anonymous viewer', () => {
    expect(gateProjectPrd(prd, null, 'owner-1')).toBeNull()
  })

  it('withholds the PRD from a signed-in non-participant', () => {
    expect(gateProjectPrd(prd, 'stranger-1', 'owner-1', false)).toBeNull()
  })

  it('returns null when there is no PRD', () => {
    expect(gateProjectPrd(null, 'owner-1', 'owner-1')).toBeNull()
  })
})

describe('redactBrd', () => {
  const full = {
    id: 'brd-1',
    status: 'draft',
    content: {
      executive_summary: 'summary',
      business_objectives: ['a'],
      scope: 'secret scope',
      functional_requirements: ['secret'],
      estimated_price_min: 99_000,
    },
  }

  it('exposes only the summary and objectives before payment', () => {
    expect(redactBrd(full).content).toEqual({
      executive_summary: 'summary',
      business_objectives: ['a'],
    })
  })

  it('returns the full BRD once paid', () => {
    expect(redactBrd({ ...full, status: 'paid' }).content).toBe(full.content)
  })

  it('returns the full BRD once approved', () => {
    const content = redactBrd({ ...full, status: 'approved' }).content as Record<string, unknown>
    expect(content.scope).toBe('secret scope')
  })

  it('handles a null content', () => {
    expect(redactBrd({ id: 'brd-2', status: 'draft', content: null }).content).toBeNull()
  })
})
