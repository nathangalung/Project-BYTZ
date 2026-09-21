import { AppError, normalizeBrdContent, normalizePrdContent } from '@kerjacus/shared'

const SUMMARY_DESCRIPTION_CHARS = 120

type VisibilityInput = {
  // Absent on public listings, which never select it.
  ownerId?: string | null
  visibility: string
  description: string | null
  finalPrice?: unknown
  platformFee?: unknown
  talentPayout?: unknown
  budgetMin?: unknown
  budgetMax?: unknown
  preferences?: unknown
  projectType?: unknown
  companyName?: unknown
  companyRole?: unknown
  documentFileUrl?: unknown
  documentType?: unknown
}

/**
 * Decide what a viewer is allowed to see of a project.
 *
 * GET /projects/:id is deliberately reachable without a session so that public
 * project pages work, which makes this the only thing standing between a project
 * id and the full row - including the internal money columns. `private` throws
 * NOT_FOUND rather than FORBIDDEN so the response never confirms the id exists.
 *
 * Three viewer classes. The owner sees the row as stored. A talent assigned to
 * the project sees it whatever the visibility says, with the full brief but no
 * money, because visibility is the owner's choice about strangers and an
 * assigned talent is under contract - assertProjectAccess already admits them
 * to milestones, time logs and work packages. Everyone else is subject to
 * visibility.
 *
 * Pass viewerId = null for an anonymous request.
 */
export function applyProjectVisibility<T extends VisibilityInput>(
  project: T,
  viewerId: string | null,
  isAssignedTalent = false,
): Partial<T> {
  if (viewerId !== null && project.ownerId != null && viewerId === project.ownerId) {
    return project
  }

  const participant = viewerId !== null && isAssignedTalent

  if (project.visibility === 'private' && !participant) {
    throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
  }

  // finalPrice / platformFee / talentPayout are owner-and-admin only. What this
  // buys is narrower than it used to claim: the bracket table is published, so
  // a seat payout on a single-package project inverts to the price it came from
  // and the margin follows. What stays hidden is the price of a project nobody
  // has been quoted for, and the fee as a line item.
  //
  // budgetMin / budgetMax go with them. The band is what the owner typed at
  // intake before the AI priced anything, and browse cards that advertised it
  // quoted several times what a seat pays. It is the owner's own working
  // figure, not public marketing, and a stranger who reads it reads a guess.
  const {
    finalPrice: _finalPrice,
    platformFee: _platformFee,
    talentPayout: _talentPayout,
    budgetMin: _budgetMin,
    budgetMax: _budgetMax,
    ...money
  } = project

  if (participant) {
    return money as Partial<T>
  }

  // A public project page advertises the work, not the buyer. ownerId is the
  // join key to every route keyed on a user and, via a review or a talent
  // lookup, to a real name; the company fields identify the buyer outright;
  // and documentFileUrl is the owner's own uploaded spec, the same class of
  // thing gateProjectBrd and gateProjectPrd already withhold.
  //
  // Strangers only. An assigned talent is under contract, and the review form
  // addresses a talent_to_owner review with project.ownerId - stripping it for
  // them would leave the talent unable to review the owner at all.
  const {
    ownerId: _ownerId,
    projectType: _projectType,
    companyName: _companyName,
    companyRole: _companyRole,
    documentFileUrl: _documentFileUrl,
    documentType: _documentType,
    ...visible
  } = money

  // Summarising the brief for someone building it makes no sense.
  if (project.visibility === 'public_summary') {
    return {
      ...visible,
      description: project.description
        ? `${project.description.substring(0, SUMMARY_DESCRIPTION_CHARS)}...`
        : null,
      preferences: null,
    } as Partial<T>
  }

  return visible as Partial<T>
}

/**
 * Whether the paid unlock for this document has been settled. Resolved by the
 * caller from isDocumentPaid; `'unpaid'` is the default everywhere so a call
 * site that forgets to ask still gets the gated projection.
 */
export type DocumentUnlock = 'paid' | 'unpaid'

type DocumentRow = { content?: unknown }

/**
 * A document as a viewer may read it. `contentLocked` is explicit rather than
 * inferred from a missing field: BRD and PRD content is model-authored JSONB
 * and a section absent on an old row is indistinguishable from a section the
 * buyer view withheld, so the reader is told outright which one it is.
 */
export type GatedDocument<T> = T & { contentLocked: boolean }

/**
 * The PRD an owner may read before paying for it.
 *
 * Built as an allowlist over normalised content, never as a rest-spread minus
 * the sensitive keys - the same rule publicProjectScope follows, and for the
 * same reason: normalizePrdContent accepts `apiDesign` and `api_design` alike,
 * so deleting one spelling from the stored JSONB ships the other.
 *
 * What it keeps has to justify the purchase: what will be built, by how many
 * people, over how long, for how much in total. What it drops is everything
 * that makes the document buildable somewhere else - the endpoints, the
 * schema, why each tool was chosen, the per-package effort and price that
 * reconstruct a quote, the acceptance criteria and the dependency order.
 */
export type PrdBuyerContent = {
  techStack: { name: string; category: string }[]
  teamComposition: { role: string; skills: string[] }[]
  workPackages: { name: string; requiredSkills: string[]; deliverables: { title: string }[] }[]
  sprintPlan: { name: string; duration: string }[]
  assumptions: string[]
  risks: string[]
  totalCost: number
  teamSize: number
  totalEstimatedHours: number
  estimatedTimelineDays: number
  traceability: { requirementCount: number; coveredCount: number; coveragePercent: number }
}

export function prdBuyerContent(content: unknown): PrdBuyerContent {
  const c = normalizePrdContent(content)
  return {
    // The stack family, not the rationale that explains the choice.
    techStack: c.techStack.map((t) => ({ name: t.name, category: t.category })),
    // Who is needed, not how many hours each of them is booked for.
    teamComposition: c.teamComposition.map((m) => ({ role: m.role, skills: m.skills })),
    workPackages: c.workPackages.map((w) => ({
      name: w.name,
      requiredSkills: w.requiredSkills,
      // Titles only: `expected` is the outcome spec, and `type` follows it.
      deliverables: w.deliverables.map((d) => ({ title: d.title })),
    })),
    // The phase outline, without the milestones that say what lands when.
    sprintPlan: c.sprintPlan.map((s) => ({ name: s.name, duration: s.duration })),
    assumptions: c.assumptions,
    risks: c.risks,
    // The project total is what the owner is being asked to fund, so it stays.
    // Per-package amounts do not: the fee bracket table is published and one
    // amount inverts to the payout and the margin behind it.
    totalCost: c.totalCost,
    teamSize: c.teamSize,
    totalEstimatedHours: c.totalEstimatedHours,
    estimatedTimelineDays: c.estimatedTimelineDays,
    // Coverage as a quality signal. The uncovered and untraced lists are the
    // requirement ids themselves, which belong to the document.
    traceability: {
      requirementCount: c.traceability.requirementCount,
      coveredCount: c.traceability.coveredCount,
      coveragePercent: c.traceability.coveragePercent,
    },
  }
}

/**
 * The BRD an owner may read before paying for it.
 *
 * Less is withheld than from the PRD - the BRD is the business case, and the
 * business case is what the purchase is decided on - but the requirement
 * bodies are still a specification. Headings and identifiers survive so the
 * owner can see the document's shape and size; the text under them does not.
 */
export type BrdBuyerContent = {
  executiveSummary: string
  businessObjectives: string[]
  successMetrics: string[]
  scope: string
  outOfScope: string[]
  expectedBenefits: string[]
  riskAssessment: string[]
  stakeholders: { id: string; title: string }[]
  targetUsers: { id: string; title: string }[]
  timelinePhases: { id: string; title: string }[]
  functionalRequirements: { id: string; title: string }[]
  estimatedPriceMin: number
  estimatedPriceMax: number
  estimatedTimelineDays: number
  estimatedTeamSize: number
}

export function brdBuyerContent(content: unknown): BrdBuyerContent {
  const c = normalizeBrdContent(content)
  const heading = (items: { id: string; title: string }[]) =>
    items.map((i) => ({ id: i.id, title: i.title }))
  return {
    executiveSummary: c.executiveSummary,
    businessObjectives: c.businessObjectives,
    successMetrics: c.successMetrics,
    scope: c.scope,
    outOfScope: c.outOfScope,
    expectedBenefits: c.expectedBenefits,
    riskAssessment: c.riskAssessment,
    stakeholders: heading(c.stakeholders),
    targetUsers: heading(c.targetUsers),
    timelinePhases: heading(c.timelinePhases),
    functionalRequirements: heading(c.functionalRequirements),
    estimatedPriceMin: c.estimatedPriceMin,
    estimatedPriceMax: c.estimatedPriceMax,
    estimatedTimelineDays: c.estimatedTimelineDays,
    estimatedTeamSize: c.estimatedTeamSize,
    // businessRules and nonFunctionalRequirements are dropped outright: both
    // are flat lists of rules to implement, with no heading to keep.
  }
}

function gateDocument<T extends DocumentRow>(
  doc: T | null | undefined,
  viewerId: string | null,
  ownerId: string | null,
  isAssignedTalent: boolean,
  unlock: DocumentUnlock,
  buyerContent: (content: unknown) => unknown,
): GatedDocument<T> | null {
  if (!doc) return null

  // An assigned talent is under contract and the document is their brief, so
  // the owner's payment is not theirs to wait on.
  if (viewerId !== null && isAssignedTalent) return { ...doc, contentLocked: false }

  const isOwner = viewerId !== null && ownerId != null && viewerId === ownerId
  if (!isOwner) return null

  if (unlock === 'paid') return { ...doc, contentLocked: false }
  return { ...doc, content: buyerContent(doc.content), contentLocked: true }
}

/**
 * What a viewer may read of a project's PRD.
 *
 * Three tiers. A stranger gets null: GET /projects/:id is anonymous-reachable
 * and the PRD is not public marketing. An owner who has not paid gets the
 * buyer view - enough to decide on the purchase, not enough to have it built
 * elsewhere - because the document is the product and serving it whole to an
 * unpaid buyer is giving the product away. An owner who has paid, and an
 * assigned talent, get the document as stored.
 */
export function gateProjectPrd<T extends DocumentRow>(
  prd: T | null | undefined,
  viewerId: string | null,
  ownerId: string | null,
  isAssignedTalent = false,
  unlock: DocumentUnlock = 'unpaid',
): GatedDocument<T> | null {
  return gateDocument(prd, viewerId, ownerId, isAssignedTalent, unlock, prdBuyerContent)
}

/**
 * What a viewer may read of a project's BRD, on the same three tiers as
 * gateProjectPrd. The BRD carries less of the blueprint, so its buyer view
 * keeps more, but an unpaid owner still does not receive the requirement text.
 */
export function gateProjectBrd<T extends DocumentRow>(
  brd: T | null | undefined,
  viewerId: string | null,
  ownerId: string | null,
  isAssignedTalent = false,
  unlock: DocumentUnlock = 'unpaid',
): GatedDocument<T> | null {
  return gateDocument(brd, viewerId, ownerId, isAssignedTalent, unlock, brdBuyerContent)
}
