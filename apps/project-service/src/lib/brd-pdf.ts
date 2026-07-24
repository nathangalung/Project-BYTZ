import type { BrdLanguage, BrdPdfContent, BrdPdfData } from '../templates/BrdDocument'

type Raw = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Map stored BRD content (snake or camel) to the PDF shape. */
export function normalizeBrdContent(raw: Raw): BrdPdfContent {
  const fr = raw.functional_requirements ?? raw.functionalRequirements
  return {
    executiveSummary: str(raw.executive_summary ?? raw.executiveSummary),
    businessObjectives: strList(raw.business_objectives ?? raw.businessObjectives),
    successMetrics: strList(raw.success_metrics ?? raw.successMetrics),
    scope: str(raw.scope),
    outOfScope: strList(raw.out_of_scope ?? raw.outOfScope),
    functionalRequirements: Array.isArray(fr)
      ? fr.map((f) => ({ title: str((f as Raw)?.title), content: str((f as Raw)?.content) }))
      : [],
    nonFunctionalRequirements: strList(
      raw.non_functional_requirements ?? raw.nonFunctionalRequirements,
    ),
    estimatedPriceMin: num(raw.estimated_price_min ?? raw.estimatedPriceMin),
    estimatedPriceMax: num(raw.estimated_price_max ?? raw.estimatedPriceMax),
    estimatedTimelineDays: num(raw.estimated_timeline_days ?? raw.estimatedTimelineDays),
    estimatedTeamSize: num(raw.estimated_team_size ?? raw.estimatedTeamSize ?? raw.team_size) || 1,
    riskAssessment: strList(raw.risk_assessment ?? raw.riskAssessment),
  }
}

/** Document language, defaulting to Indonesian. */
export function brdLanguage(raw: Raw): BrdLanguage {
  return raw.language === 'en' ? 'en' : 'id'
}

/** Render a BRD to a PDF buffer. Lazy-imports the renderer. */
export async function renderBrdPdf(data: BrdPdfData): Promise<Buffer> {
  const [{ renderToBuffer }, { BrdDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('../templates/BrdDocument'),
  ])
  return (await renderToBuffer(BrdDocument({ data }) as never)) as Buffer
}
