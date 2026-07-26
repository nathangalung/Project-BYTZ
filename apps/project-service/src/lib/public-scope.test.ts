import { describe, expect, it } from 'vitest'
import { publicProjectScope } from './public-scope'

/**
 * public_detail means the owner chose to advertise what the project actually
 * involves, not just its headline. The PRD holds that detail, but the PRD
 * document itself is the owner's paid deliverable and carries per-package
 * pricing, so gateProjectPrd rightly hands a stranger nothing.
 *
 * This is the projection between the two: the scope a talent needs to decide
 * whether to apply, with every money field left behind.
 *
 * The money constraint is not cosmetic. The fee bracket table is published,
 * so a per-package `amount` lets anyone reconstruct talent_payout and
 * platform_fee - exactly what the finalPrice/platformFee/talentPayout strip
 * exists to prevent. The projection is therefore an allowlist: prd content is
 * LLM-authored JSONB, and a denylist leaks whatever key the model invents next.
 */

const prd = {
  content: {
    techStack: [{ name: 'React', category: 'frontend', description: 'UI', recommended: true }],
    architecture: 'Modular monolith',
    teamComposition: [{ role: 'Backend', skills: ['Go'], estimatedHours: 120 }],
    workPackages: [
      {
        name: 'Payments',
        requiredSkills: ['Go', 'PostgreSQL'],
        estimatedHours: 120,
        amount: 12_000_000,
        dependencies: ['Auth'],
        deliverables: [{ title: 'Webhook handler', type: 'code', expected: 'merged' }],
        acceptanceCriteria: ['Signature verified'],
      },
    ],
    sprintPlan: [{ name: 'Sprint 1', duration: '2 weeks', milestones: ['Auth'] }],
    assumptions: ['Midtrans sandbox'],
    risks: ['Gateway downtime'],
    totalCost: 12_000_000,
    teamSize: 2,
    totalEstimatedHours: 240,
    apiDesign: [{ method: 'POST', path: '/pay', description: 'charge' }],
    databaseSchema: [{ name: 'payments', description: 'ledger', columns: 8 }],
  },
}

describe('publicProjectScope', () => {
  const scope = publicProjectScope(prd, 'public_detail')

  it('describes the work', () => {
    expect(scope?.architecture).toBe('Modular monolith')
    expect(scope?.teamSize).toBe(2)
    expect(scope?.workPackages[0]?.name).toBe('Payments')
    expect(scope?.workPackages[0]?.requiredSkills).toEqual(['Go', 'PostgreSQL'])
    expect(scope?.workPackages[0]?.deliverables[0]?.title).toBe('Webhook handler')
  })

  it('carries no per-package amount', () => {
    expect(scope?.workPackages[0]).not.toHaveProperty('amount')
  })

  it('carries no total cost', () => {
    expect(scope).not.toHaveProperty('totalCost')
    expect(JSON.stringify(scope)).not.toContain('12000000')
  })

  /**
   * The content column is model-authored. A field nobody enumerated must not
   * ride along just because the model emitted it.
   */
  it('ignores a field the model invented', () => {
    const withExtra = {
      content: {
        ...prd.content,
        internalMargin: 3_400_000,
        workPackages: [{ ...prd.content.workPackages[0], talentPayout: 8_600_000 }],
      },
    }
    const seen = publicProjectScope(withExtra, 'public_detail')
    expect(seen).not.toHaveProperty('internalMargin')
    expect(seen?.workPackages[0]).not.toHaveProperty('talentPayout')
    expect(JSON.stringify(seen)).not.toContain('8600000')
  })

  it('withholds the scope from a summary-only project', () => {
    expect(publicProjectScope(prd, 'public_summary')).toBeNull()
  })

  it('withholds the scope from a private project', () => {
    expect(publicProjectScope(prd, 'private')).toBeNull()
  })

  it('has nothing to show without a PRD', () => {
    expect(publicProjectScope(null, 'public_detail')).toBeNull()
  })
})
