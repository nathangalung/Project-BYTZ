import { normalizePrdContent } from '@kerjacus/shared'

/**
 * The scope a stranger may read on a public_detail project.
 *
 * Deliberately not the PRD. gateProjectPrd keeps the document itself owner-and-
 * participant only, because it is the owner's paid deliverable and carries
 * per-package pricing; this is the browsing view built from it, so "who may
 * read the deliverable" and "what a browser sees" stay two separate decisions.
 *
 * Every money field is left behind. The fee bracket table is published, so a
 * per-package amount is enough to reconstruct talent_payout and platform_fee -
 * the very thing the money strip in applyProjectVisibility exists to prevent.
 */
type PublicScopeWorkPackage = {
  name: string
  requiredSkills: string[]
  estimatedHours: number
  dependencies: string[]
  deliverables: { title: string; type: string }[]
  acceptanceCriteria: string[]
}

type PublicProjectScope = {
  architecture: string
  techStack: { name: string; category: string; description: string }[]
  teamComposition: { role: string; skills: string[]; estimatedHours: number }[]
  workPackages: PublicScopeWorkPackage[]
  sprintPlan: { name: string; duration: string; milestones: string[] }[]
  assumptions: string[]
  risks: string[]
  teamSize: number
  totalEstimatedHours: number
}

/**
 * Built as an allowlist, never as a rest-spread minus the money keys.
 * prd_documents.content is LLM-authored JSONB - normalizePrdContent already
 * accepts two spellings for the same key - so a denylist ships whatever field
 * the model invents next straight to an anonymous reader.
 */
export function publicProjectScope(
  prd: { content?: unknown } | null | undefined,
  visibility: string,
): PublicProjectScope | null {
  if (!prd || visibility !== 'public_detail') return null

  const c = normalizePrdContent(prd.content)

  return {
    architecture: c.architecture,
    techStack: c.techStack.map((t) => ({
      name: t.name,
      category: t.category,
      description: t.description,
    })),
    teamComposition: c.teamComposition.map((m) => ({
      role: m.role,
      skills: m.skills,
      estimatedHours: m.estimatedHours,
    })),
    workPackages: c.workPackages.map((w) => ({
      name: w.name,
      requiredSkills: w.requiredSkills,
      estimatedHours: w.estimatedHours,
      dependencies: w.dependencies,
      // Effort and outcome, never price.
      deliverables: w.deliverables.map((d) => ({ title: d.title, type: d.type })),
      acceptanceCriteria: w.acceptanceCriteria,
    })),
    sprintPlan: c.sprintPlan.map((s) => ({
      name: s.name,
      duration: s.duration,
      milestones: s.milestones,
    })),
    assumptions: c.assumptions,
    risks: c.risks,
    teamSize: c.teamSize,
    totalEstimatedHours: c.totalEstimatedHours,
  }
}
