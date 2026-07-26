export type FunctionalRequirement = { title: string; content: string }

export type BrdContent = {
  executiveSummary: string
  businessObjectives: string[]
  successMetrics: string[]
  scope: string
  outOfScope: string[]
  functionalRequirements: FunctionalRequirement[]
  nonFunctionalRequirements: string[]
  estimatedPriceMin: number
  estimatedPriceMax: number
  estimatedTimelineDays: number
  estimatedTeamSize: number
  riskAssessment: string[]
}

type Raw = Record<string, unknown>

function obj(value: unknown): Raw {
  return value && typeof value === 'object' ? (value as Raw) : {}
}

/** First key present wins, so a row may use either spelling. */
function pick(raw: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Risks are strings today. Older rows hold { risk, mitigation } objects, and
 * filtering for strings dropped those silently - a pre-migration project
 * printed a paid PDF with an empty risk section.
 */
function riskList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry : str(obj(entry).risk)))
    .filter(Boolean)
}

/**
 * The model emits { title, content }; older rows used { title, description }.
 * Reading only `content` printed the heading with nothing under it.
 */
function requirementList(value: unknown): FunctionalRequirement[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const r = obj(entry)
    return { title: str(r.title), content: str(pick(r, 'content', 'description')) }
  })
}

/**
 * The one place stored BRD content becomes the app's shape.
 *
 * It existed twice - in the web preview and in brd-pdf.ts for the paid
 * download - and the copies drifted in both directions: the preview missed
 * estimated_team_size and claimed a team of one, while the PDF dropped legacy
 * risk objects and requirement bodies, so the paid document held less than
 * the free preview. prd-content.ts already lives here for this reason.
 *
 * Deliberately total: content is model-authored JSONB and may be absent,
 * partial, or not an object, and a viewer must never crash on an old row.
 */
export function normalizeBrdContent(input: unknown): BrdContent {
  const raw = obj(input)
  return {
    executiveSummary: str(pick(raw, 'executiveSummary', 'executive_summary')),
    businessObjectives: strList(pick(raw, 'businessObjectives', 'business_objectives')),
    successMetrics: strList(pick(raw, 'successMetrics', 'success_metrics')),
    scope: str(raw.scope),
    outOfScope: strList(pick(raw, 'outOfScope', 'out_of_scope')),
    functionalRequirements: requirementList(
      pick(raw, 'functionalRequirements', 'functional_requirements'),
    ),
    nonFunctionalRequirements: strList(
      pick(raw, 'nonFunctionalRequirements', 'non_functional_requirements'),
    ),
    estimatedPriceMin: num(pick(raw, 'estimatedPriceMin', 'estimated_price_min')),
    estimatedPriceMax: num(pick(raw, 'estimatedPriceMax', 'estimated_price_max')),
    estimatedTimelineDays: num(pick(raw, 'estimatedTimelineDays', 'estimated_timeline_days')),
    estimatedTeamSize: num(pick(raw, 'estimatedTeamSize', 'estimated_team_size', 'team_size')) || 1,
    riskAssessment: riskList(pick(raw, 'riskAssessment', 'risk_assessment')),
  }
}

/** Document language, defaulting to Indonesian. */
export function brdLanguage(input: unknown): 'id' | 'en' {
  return obj(input).language === 'en' ? 'en' : 'id'
}
