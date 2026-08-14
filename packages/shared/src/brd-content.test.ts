import { describe, expect, it } from 'vitest'
import { brdLanguage, normalizeBrdContent } from './brd-content'

/**
 * BRD content was normalised twice - once in the web preview, once in
 * brd-pdf.ts for the paid download - because the stored column is
 * model-authored snake_case and the app is camelCase. The two drifted, and
 * the drift was not symmetric:
 *
 *   - the preview missed estimated_team_size and showed a team of 1
 *   - the PDF dropped legacy risk objects and the `description` body of older
 *     functional requirements, so the document the owner PAID for held less
 *     than the free preview did
 *
 * prd-content.ts already lives here for exactly this reason. This is its BRD
 * counterpart, and it takes the superset of what either side handled.
 */

describe('normalizeBrdContent', () => {
  it('reads the snake_case the model emits', () => {
    const c = normalizeBrdContent({
      executive_summary: 'Ringkasan',
      business_objectives: ['Naikkan konversi'],
      success_metrics: ['CR 3%'],
      out_of_scope: ['Native app'],
      non_functional_requirements: ['P95 < 500ms'],
      estimated_price_min: 5_000_000,
      estimated_price_max: 9_000_000,
      estimated_timeline_days: 60,
      estimated_team_size: 3,
    })
    expect(c.executiveSummary).toBe('Ringkasan')
    expect(c.businessObjectives).toEqual(['Naikkan konversi'])
    expect(c.successMetrics).toEqual(['CR 3%'])
    expect(c.outOfScope).toEqual(['Native app'])
    expect(c.nonFunctionalRequirements).toEqual(['P95 < 500ms'])
    expect(c.estimatedPriceMin).toBe(5_000_000)
    expect(c.estimatedPriceMax).toBe(9_000_000)
    expect(c.estimatedTimelineDays).toBe(60)
    expect(c.estimatedTeamSize).toBe(3)
  })

  it('reads camelCase just as well', () => {
    const c = normalizeBrdContent({ executiveSummary: 'Summary', estimatedTeamSize: 4 })
    expect(c.executiveSummary).toBe('Summary')
    expect(c.estimatedTeamSize).toBe(4)
  })

  /**
   * The bug that started this: the preview looked for estimatedTeamSize and
   * team_size but not the spelling the model actually emits, so it fell to
   * its default while the PDF showed the real figure.
   */
  it('accepts all three team-size spellings', () => {
    expect(normalizeBrdContent({ estimated_team_size: 5 }).estimatedTeamSize).toBe(5)
    expect(normalizeBrdContent({ estimatedTeamSize: 5 }).estimatedTeamSize).toBe(5)
    expect(normalizeBrdContent({ team_size: 5 }).estimatedTeamSize).toBe(5)
  })

  it('defaults to a team of one only when no spelling is present', () => {
    expect(normalizeBrdContent({}).estimatedTeamSize).toBe(1)
  })

  /**
   * Risks are stored as strings now, but older rows hold
   * { risk, mitigation } objects. strList dropped those silently, so a
   * pre-migration project printed a PDF with an empty risk section.
   */
  it('keeps a legacy risk object rather than dropping it', () => {
    const c = normalizeBrdContent({
      risk_assessment: [
        'Gateway downtime',
        { risk: 'Scope creep', mitigation: 'Change request' },
        { risk: '' },
      ],
    })
    expect(c.riskAssessment).toEqual(['Gateway downtime', 'Scope creep'])
  })

  /**
   * Same shape of loss: the model emits { title, content }, older rows used
   * { title, description }. Reading only `content` printed the heading with
   * no body under it.
   */
  it('keeps the body of a legacy functional requirement', () => {
    const c = normalizeBrdContent({
      functional_requirements: [
        { title: 'Login', content: 'Email dan Google' },
        { title: 'Checkout', description: 'Midtrans' },
      ],
    })
    expect(c.functionalRequirements).toEqual([
      { title: 'Login', content: 'Email dan Google' },
      { title: 'Checkout', content: 'Midtrans' },
    ])
  })

  it('survives a row with nothing in it', () => {
    const c = normalizeBrdContent({})
    expect(c.executiveSummary).toBe('')
    expect(c.businessObjectives).toEqual([])
    expect(c.functionalRequirements).toEqual([])
    expect(c.riskAssessment).toEqual([])
    expect(c.estimatedPriceMin).toBe(0)
  })

  it('survives content that is not an object at all', () => {
    expect(normalizeBrdContent(null).executiveSummary).toBe('')
    expect(normalizeBrdContent('nonsense').businessObjectives).toEqual([])
  })
})

/**
 * The owner picks the document language at generation and the value reaches
 * here straight from a request body, so anything that is not exactly 'en'
 * has to land on Indonesian rather than on undefined.
 */
describe('brdLanguage', () => {
  it('returns English only for an exact match', () => {
    expect(brdLanguage({ language: 'en' })).toBe('en')
    expect(brdLanguage({ language: 'EN' })).toBe('id')
    expect(brdLanguage({ language: 'english' })).toBe('id')
  })

  it('defaults to Indonesian', () => {
    expect(brdLanguage({ language: 'id' })).toBe('id')
    expect(brdLanguage({})).toBe('id')
  })

  it('defaults to Indonesian for input that is not an object at all', () => {
    expect(brdLanguage(null)).toBe('id')
    expect(brdLanguage(undefined)).toBe('id')
    expect(brdLanguage('en')).toBe('id')
    expect(brdLanguage(42)).toBe('id')
  })
})
