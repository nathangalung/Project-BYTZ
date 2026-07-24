import { DependencyType, type PrdContent } from '@kerjacus/shared'

export type PlannedWorkPackage = {
  title: string
  description: string
  requiredSkills: string[]
  estimatedHours: number
  payout: number
  orderIndex: number
}

/**
 * Turn a PRD's work packages into rows ready for creation.
 *
 * Payout is the primitive: the PRD's per-package amount is the talent payout,
 * which the work-package service marks up into the owner amount. A single
 * worker takes the whole project as one package (skills unioned, hours and
 * payout summed); a team gets one package per role. Only priced packages
 * survive, so the amount and estimated_hours CHECK constraints always hold; an
 * unpriced PRD yields an empty plan rather than a constraint violation.
 */
export function planWorkPackages(
  prd: PrdContent,
  teamSize: number,
  projectTitle: string,
): PlannedWorkPackage[] {
  const priced = prd.workPackages.filter((w) => w.amount > 0 && w.estimatedHours > 0)
  if (priced.length === 0) return []

  if (teamSize <= 1) {
    return [
      {
        title: projectTitle,
        description: 'Full project delivery',
        requiredSkills: [...new Set(priced.flatMap((w) => w.requiredSkills))],
        estimatedHours: priced.reduce((sum, w) => sum + w.estimatedHours, 0),
        payout: priced.reduce((sum, w) => sum + w.amount, 0),
        orderIndex: 0,
      },
    ]
  }

  return priced.map((w, i) => ({
    title: w.name,
    description: '',
    requiredSkills: w.requiredSkills,
    estimatedHours: w.estimatedHours,
    payout: w.amount,
    orderIndex: i,
  }))
}

export type PlannedDependency = {
  workPackageId: string
  dependsOnWorkPackageId: string
  type: DependencyType
}

const DEPENDENCY_TYPES = new Set<string>(Object.values(DependencyType))

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Map the PRD's dependency graph onto the work packages it created.
 *
 * The PRD names packages while the rows carry ids, so the title is the join
 * key, normalised because the model drifts on case and spacing between the
 * package list and the graph. The prompt defines `from` as the package that
 * must finish first, so it becomes depends_on and `to` becomes the dependent.
 * Edges naming a package that was never created, self references and repeats
 * are dropped: the unique index rejects repeats anyway, and one unusable edge
 * should not cost the rest of the graph. A type the model invented falls back
 * to finish_to_start rather than losing the edge to the database enum. Fewer
 * than two packages means a single-talent project, where every name resolves
 * to the one row and no real edge exists.
 */
export function planDependencies(
  prd: PrdContent,
  packages: readonly { id: string; title: string }[],
): PlannedDependency[] {
  if (packages.length < 2) return []

  const idByTitle = new Map(packages.map((p) => [normalizeTitle(p.title), p.id]))
  const seen = new Set<string>()
  const edges: PlannedDependency[] = []

  for (const dep of prd.dependencyGraph) {
    const dependsOnWorkPackageId = idByTitle.get(normalizeTitle(dep.from))
    const workPackageId = idByTitle.get(normalizeTitle(dep.to))
    if (!dependsOnWorkPackageId || !workPackageId) continue
    if (dependsOnWorkPackageId === workPackageId) continue

    const key = `${workPackageId}:${dependsOnWorkPackageId}`
    if (seen.has(key)) continue
    seen.add(key)

    edges.push({
      workPackageId,
      dependsOnWorkPackageId,
      type: DEPENDENCY_TYPES.has(dep.type) ? (dep.type as DependencyType) : 'finish_to_start',
    })
  }

  return edges
}
