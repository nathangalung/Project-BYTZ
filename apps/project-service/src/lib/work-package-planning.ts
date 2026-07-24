import type { PrdContent } from '@kerjacus/shared'

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
