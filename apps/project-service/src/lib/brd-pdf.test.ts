import { describe, expect, it } from 'vitest'
import { brdLanguage, normalizeBrdContent } from './brd-pdf'

describe('normalizeBrdContent', () => {
  it('reads snake_case content', () => {
    const c = normalizeBrdContent({
      executive_summary: 'summary',
      business_objectives: ['a', 'b'],
      out_of_scope: ['x'],
      functional_requirements: [{ title: 'T', content: 'C' }],
      estimated_price_min: 10,
      estimated_price_max: 20,
      estimated_timeline_days: 30,
      estimated_team_size: 2,
    })
    expect(c.executiveSummary).toBe('summary')
    expect(c.businessObjectives).toEqual(['a', 'b'])
    expect(c.outOfScope).toEqual(['x'])
    expect(c.functionalRequirements).toEqual([{ title: 'T', content: 'C' }])
    expect(c.estimatedPriceMax).toBe(20)
    expect(c.estimatedTeamSize).toBe(2)
  })

  it('reads camelCase content', () => {
    const c = normalizeBrdContent({ executiveSummary: 's', businessObjectives: ['o'] })
    expect(c.executiveSummary).toBe('s')
    expect(c.businessObjectives).toEqual(['o'])
  })

  it('defaults team size to one and lists to empty', () => {
    const c = normalizeBrdContent({})
    expect(c.estimatedTeamSize).toBe(1)
    expect(c.businessObjectives).toEqual([])
    expect(c.functionalRequirements).toEqual([])
  })

  it('drops non-string list entries', () => {
    const c = normalizeBrdContent({ business_objectives: ['ok', 5, null] })
    expect(c.businessObjectives).toEqual(['ok'])
  })
})

describe('brdLanguage', () => {
  it('defaults to Indonesian', () => {
    expect(brdLanguage({})).toBe('id')
  })

  it('honours an explicit English choice', () => {
    expect(brdLanguage({ language: 'en' })).toBe('en')
  })
})
