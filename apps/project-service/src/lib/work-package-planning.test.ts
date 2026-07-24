import type { PrdContent, WorkPackageItem } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { planWorkPackages } from './work-package-planning'

function wp(over: Partial<WorkPackageItem>): WorkPackageItem {
  return {
    name: 'WP',
    requiredSkills: [],
    estimatedHours: 10,
    amount: 1000,
    dependencies: [],
    deliverables: [],
    acceptanceCriteria: [],
    ...over,
  }
}

function prd(workPackages: WorkPackageItem[]): PrdContent {
  return {
    techStack: [],
    architecture: '',
    apiDesign: [],
    databaseSchema: [],
    teamComposition: [],
    workPackages,
    sprintPlan: [],
    dependencyGraph: [],
    assumptions: [],
    risks: [],
    totalCost: 0,
    teamSize: 0,
    totalEstimatedHours: 0,
  }
}

describe('planWorkPackages', () => {
  const roles = [
    wp({
      name: 'Backend',
      requiredSkills: ['node', 'postgres'],
      estimatedHours: 100,
      amount: 5000,
    }),
    wp({ name: 'Frontend', requiredSkills: ['react', 'node'], estimatedHours: 80, amount: 4000 }),
  ]

  it('collapses a single-worker project into one whole-project package', () => {
    const plan = planWorkPackages(prd(roles), 1, 'Toko Online')
    expect(plan).toHaveLength(1)
    expect(plan[0].title).toBe('Toko Online')
    expect(plan[0].orderIndex).toBe(0)
    expect(plan[0].estimatedHours).toBe(180)
    expect(plan[0].amount).toBe(9000)
  })

  it('dedupes skills across roles in the aggregate package', () => {
    const plan = planWorkPackages(prd(roles), 1, 'Toko Online')
    // node appears in both roles but must not be listed twice.
    expect([...plan[0].requiredSkills].sort()).toEqual(['node', 'postgres', 'react'])
  })

  it('keeps one package per role for a team project', () => {
    const plan = planWorkPackages(prd(roles), 2, 'Toko Online')
    expect(plan.map((p) => p.title)).toEqual(['Backend', 'Frontend'])
    expect(plan.map((p) => p.orderIndex)).toEqual([0, 1])
    expect(plan[0].amount).toBe(5000)
  })

  it('drops unpriced packages so the amount/hours CHECK holds', () => {
    const mixed = [
      wp({ name: 'Real', amount: 3000, estimatedHours: 40 }),
      wp({ name: 'ZeroAmount', amount: 0, estimatedHours: 40 }),
      wp({ name: 'ZeroHours', amount: 3000, estimatedHours: 0 }),
    ]
    const plan = planWorkPackages(prd(mixed), 3, 'Proyek')
    expect(plan.map((p) => p.title)).toEqual(['Real'])
  })

  it('returns an empty plan when nothing is priced', () => {
    const plan = planWorkPackages(prd([wp({ amount: 0 })]), 1, 'Proyek')
    expect(plan).toEqual([])
  })

  it('treats a zero or missing team size as a single worker', () => {
    expect(planWorkPackages(prd(roles), 0, 'P')).toHaveLength(1)
  })
})
