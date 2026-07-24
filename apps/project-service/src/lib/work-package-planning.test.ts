import type { DependencyItem, PrdContent, WorkPackageItem } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { planDependencies, planWorkPackages } from './work-package-planning'

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

function prd(workPackages: WorkPackageItem[], dependencyGraph: DependencyItem[] = []): PrdContent {
  return {
    techStack: [],
    architecture: '',
    apiDesign: [],
    databaseSchema: [],
    teamComposition: [],
    workPackages,
    sprintPlan: [],
    dependencyGraph,
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
    expect(plan[0].payout).toBe(9000)
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
    expect(plan[0].payout).toBe(5000)
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

describe('planDependencies', () => {
  const rows = [
    { id: 'wp-be', title: 'Backend' },
    { id: 'wp-fe', title: 'Frontend' },
  ]

  function dep(over: Partial<DependencyItem>): DependencyItem {
    return { from: 'Backend', to: 'Frontend', type: 'finish_to_start', ...over }
  }

  it('points the edge from the dependent at its prerequisite', () => {
    // The prompt defines from_package as the one that must finish first.
    const edges = planDependencies(prd([], [dep({})]), rows)
    expect(edges).toEqual([
      { workPackageId: 'wp-fe', dependsOnWorkPackageId: 'wp-be', type: 'finish_to_start' },
    ])
  })

  it('matches titles despite case and spacing drift', () => {
    const edges = planDependencies(prd([], [dep({ from: '  backend ', to: 'FRONT  END' })]), [
      ...rows,
      { id: 'wp-x', title: 'Front End' },
    ])
    expect(edges).toEqual([
      { workPackageId: 'wp-x', dependsOnWorkPackageId: 'wp-be', type: 'finish_to_start' },
    ])
  })

  it('keeps a valid non-default type', () => {
    const edges = planDependencies(prd([], [dep({ type: 'start_to_start' })]), rows)
    expect(edges[0].type).toBe('start_to_start')
  })

  it('falls back to finish_to_start on a type the model invented', () => {
    const edges = planDependencies(prd([], [dep({ type: 'FS' })]), rows)
    expect(edges).toHaveLength(1)
    expect(edges[0].type).toBe('finish_to_start')
  })

  it('drops an edge naming a package that was never created', () => {
    expect(planDependencies(prd([], [dep({ from: 'Mobile' })]), rows)).toEqual([])
    expect(planDependencies(prd([], [dep({ to: 'Mobile' })]), rows)).toEqual([])
  })

  it('drops a self reference', () => {
    expect(planDependencies(prd([], [dep({ from: 'Backend', to: 'backend' })]), rows)).toEqual([])
  })

  it('drops a repeat the unique index would reject', () => {
    expect(planDependencies(prd([], [dep({}), dep({})]), rows)).toHaveLength(1)
  })

  it('keeps both directions between the same pair distinct', () => {
    const edges = planDependencies(
      prd([], [dep({}), dep({ from: 'Frontend', to: 'Backend', type: 'start_to_start' })]),
      rows,
    )
    expect(edges).toHaveLength(2)
  })

  it('returns nothing for a single-talent project', () => {
    expect(planDependencies(prd([], [dep({})]), [{ id: 'wp-solo', title: 'Toko Online' }])).toEqual(
      [],
    )
  })
})
