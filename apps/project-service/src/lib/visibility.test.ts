import { AppError } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { applyProjectVisibility, gateProjectBrd, gateProjectPrd } from './visibility'

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
    expect(result.estimatedTimelineDays).toBe(60)
  })

  // The intake band is the owner's own guess, not a quote. Browse now prints
  // what an open seat pays, and the band goes with the money columns.
  it("counts the intake budget band as the owner's, not public detail", () => {
    const result = applyProjectVisibility(makeProject({ visibility: 'public_detail' }), null)

    expect(result).not.toHaveProperty('budgetMin')
    expect(result).not.toHaveProperty('budgetMax')
  })

  it('handles a null description without throwing', () => {
    const result = applyProjectVisibility(
      makeProject({ visibility: 'public_summary', description: null }),
      null,
    )

    expect(result.description).toBeNull()
  })
})

/**
 * Written the way ai-service writes it: snake_case, and with the fields that
 * make the document buildable somewhere else. The dual spelling is the point -
 * normalizePrdContent reads `api_design` as readily as `apiDesign`, so a gate
 * built by deleting keys would ship this whole body untouched.
 */
const PRD_CONTENT = {
  tech_stack: [{ name: 'Postgres', category: 'database', rationale: 'chosen because …' }],
  architecture: 'Modular monolith behind an API gateway, queue for async work.',
  api_design: [{ method: 'POST', path: '/orders', description: 'create an order' }],
  database_schema: [{ name: 'orders', description: 'one row per order', columns: 11 }],
  work_packages: [
    {
      name: 'Checkout',
      required_skills: ['React'],
      estimated_hours: 120,
      amount: 18_000_000,
      dependencies: ['Auth'],
      deliverables: [{ title: 'Checkout flow', type: 'code', expected: 'passes the smoke suite' }],
      acceptance_criteria: ['A guest can pay without an account'],
      traces_to: ['FR-001'],
    },
  ],
  sprint_plan: [{ name: 'Sprint 1', duration: '2 weeks', milestones: ['Checkout behind a flag'] }],
  dependencies: [{ from: 'Auth', to: 'Checkout', type: 'finish_to_start' }],
  assumptions: ['The payment provider is Midtrans'],
  risks: ['Provider onboarding may slip'],
  team_size: 3,
  estimated_timeline_days: 45,
  traceability: {
    requirement_count: 4,
    covered_count: 3,
    coverage_percent: 75,
    uncovered_requirements: ['FR-004'],
    untraced_work_packages: ['Checkout'],
  },
}

const BRD_CONTENT = {
  executive_summary: 'A marketplace for short engineering engagements.',
  business_objectives: ['Cut time-to-team to under a week'],
  scope: 'Web app, Indonesian market, one currency.',
  functional_requirements: [
    { id: 'FR-001', title: 'Guest checkout', content: 'The exact rule to implement.' },
  ],
  business_rules: ['Escrow releases only on milestone approval'],
  non_functional_requirements: ['p95 under 400ms'],
  estimated_price_min: 40_000_000,
  estimated_price_max: 60_000_000,
}

describe('gateProjectPrd', () => {
  const prd = { id: 'prd-1', price: 2_000_000, content: PRD_CONTENT }

  it('gives the paid owner the PRD as stored', () => {
    const result = gateProjectPrd(prd, 'owner-1', 'owner-1', false, 'paid')

    expect(result?.content).toBe(PRD_CONTENT)
    expect(result?.contentLocked).toBe(false)
  })

  it('gives an assigned talent the PRD as stored, paid or not', () => {
    const result = gateProjectPrd(prd, 'talent-1', 'owner-1', true, 'unpaid')

    expect(result?.content).toBe(PRD_CONTENT)
    expect(result?.contentLocked).toBe(false)
  })

  it('withholds the PRD from an anonymous viewer', () => {
    expect(gateProjectPrd(prd, null, 'owner-1', false, 'paid')).toBeNull()
  })

  it('withholds the PRD from a signed-in non-participant', () => {
    expect(gateProjectPrd(prd, 'stranger-1', 'owner-1', false, 'paid')).toBeNull()
  })

  it('returns null when there is no PRD', () => {
    expect(gateProjectPrd(null, 'owner-1', 'owner-1', false, 'paid')).toBeNull()
  })

  it('treats a caller that never resolved the unlock as unpaid', () => {
    expect(gateProjectPrd(prd, 'owner-1', 'owner-1')?.contentLocked).toBe(true)
  })

  // The hole this exists to close: an owner who has paid nothing used to
  // receive the whole blueprint and could have it built anywhere.
  describe('the unpaid owner', () => {
    const view = gateProjectPrd(prd, 'owner-1', 'owner-1', false, 'unpaid')
    const content = view?.content as Record<string, unknown>

    it('says outright that the content is withheld', () => {
      expect(view?.contentLocked).toBe(true)
      expect(view?.price).toBe(2_000_000)
    })

    it('drops the API design and the database schema under either spelling', () => {
      expect(content).not.toHaveProperty('apiDesign')
      expect(content).not.toHaveProperty('api_design')
      expect(content).not.toHaveProperty('databaseSchema')
      expect(content).not.toHaveProperty('database_schema')
      expect(JSON.stringify(content)).not.toContain('/orders')
      expect(JSON.stringify(content)).not.toContain('one row per order')
    })

    it('drops the architecture, the dependency order and the sprint milestones', () => {
      expect(content).not.toHaveProperty('architecture')
      expect(content).not.toHaveProperty('dependencyGraph')
      expect(content.sprintPlan).toEqual([{ name: 'Sprint 1', duration: '2 weeks' }])
    })

    it('drops per-package hours, amount, acceptance criteria and dependencies', () => {
      expect(content.workPackages).toEqual([
        {
          name: 'Checkout',
          requiredSkills: ['React'],
          deliverables: [{ title: 'Checkout flow' }],
        },
      ])
    })

    it('drops the rationale behind each tool, keeping the stack family', () => {
      expect(content.techStack).toEqual([{ name: 'Postgres', category: 'database' }])
    })

    it('keeps what the purchase is decided on: the total, the team and the clock', () => {
      expect(content.totalCost).toBe(18_000_000)
      expect(content.totalEstimatedHours).toBe(120)
      expect(content.teamSize).toBe(3)
      expect(content.estimatedTimelineDays).toBe(45)
      expect(content.assumptions).toEqual(['The payment provider is Midtrans'])
      expect(content.risks).toEqual(['Provider onboarding may slip'])
    })

    it('keeps coverage as a number but not the requirement ids behind it', () => {
      expect(content.traceability).toEqual({
        requirementCount: 4,
        coveredCount: 3,
        coveragePercent: 75,
      })
    })
  })
})

describe('gateProjectBrd', () => {
  const brd = { id: 'brd-1', content: BRD_CONTENT }

  it('gives the paid owner the BRD as stored', () => {
    const result = gateProjectBrd(brd, 'owner-1', 'owner-1', false, 'paid')

    expect(result?.content).toBe(BRD_CONTENT)
    expect(result?.contentLocked).toBe(false)
  })

  it('gives an assigned talent the BRD as stored, paid or not', () => {
    const result = gateProjectBrd(brd, 'talent-1', 'owner-1', true, 'unpaid')

    expect(result?.content).toBe(BRD_CONTENT)
    expect(result?.contentLocked).toBe(false)
  })

  it('withholds the BRD from an anonymous viewer', () => {
    expect(gateProjectBrd(brd, null, 'owner-1', false, 'paid')).toBeNull()
  })

  it('withholds the BRD from a signed-in non-participant', () => {
    expect(gateProjectBrd(brd, 'stranger-1', 'owner-1', false, 'paid')).toBeNull()
  })

  it('returns null when there is no BRD', () => {
    expect(gateProjectBrd(null, 'owner-1', 'owner-1', false, 'paid')).toBeNull()
  })

  it('treats a caller that never resolved the unlock as unpaid', () => {
    expect(gateProjectBrd(brd, 'owner-1', 'owner-1')?.contentLocked).toBe(true)
  })

  describe('the unpaid owner', () => {
    const view = gateProjectBrd(brd, 'owner-1', 'owner-1', false, 'unpaid')
    const content = view?.content as Record<string, unknown>

    it('keeps the business case the purchase is decided on', () => {
      expect(view?.contentLocked).toBe(true)
      expect(content.executiveSummary).toBe('A marketplace for short engineering engagements.')
      expect(content.scope).toBe('Web app, Indonesian market, one currency.')
      expect(content.businessObjectives).toEqual(['Cut time-to-team to under a week'])
      expect(content.estimatedPriceMin).toBe(40_000_000)
      expect(content.estimatedPriceMax).toBe(60_000_000)
    })

    it('keeps each requirement heading but not the rule underneath it', () => {
      expect(content.functionalRequirements).toEqual([{ id: 'FR-001', title: 'Guest checkout' }])
      expect(JSON.stringify(content)).not.toContain('The exact rule to implement.')
    })

    it('drops the business rules and the non-functional requirements outright', () => {
      expect(content).not.toHaveProperty('businessRules')
      expect(content).not.toHaveProperty('business_rules')
      expect(content).not.toHaveProperty('nonFunctionalRequirements')
      expect(content).not.toHaveProperty('non_functional_requirements')
      expect(JSON.stringify(content)).not.toContain('p95 under 400ms')
    })
  })
})
