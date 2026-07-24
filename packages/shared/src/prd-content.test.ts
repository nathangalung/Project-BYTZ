import { describe, expect, it } from 'vitest'
import { normalizePrdContent } from './prd-content'

/**
 * Fixture in the shape _parse_prd_response actually returns, from
 * apps/ai-service/app/routes/ai.py. Every key here is snake_case, work
 * packages carry `title` rather than `name`, sprints carry `tasks` rather than
 * `milestones`, and the dependency list is `dependencies`. The viewer read
 * camelCase throughout, so it rendered an empty document for every PRD an
 * owner had paid for.
 */
const fromAiService = {
  tech_stack: [{ category: 'Frontend', choice: 'React' }],
  architecture: 'Modular monolith',
  api_design: [{ method: 'GET', path: '/projects' }],
  database_schema: [{ name: 'projects' }],
  team_composition: [{ role: 'Backend', count: 1 }],
  work_packages: [
    { title: 'Backend API', required_skills: ['Go'], estimated_hours: 120, amount: 18_000_000 },
    { title: 'Frontend', required_skills: ['React'], estimated_hours: 80, amount: 12_000_000 },
  ],
  sprint_plan: [{ sprint_number: 1, title: 'Foundations', tasks: ['Auth'], duration_days: 14 }],
  dependencies: [{ from_package: 'Backend API', to_package: 'Frontend', type: 'finish_to_start' }],
  team_size: 2,
}

describe('normalizePrdContent on real AI output', () => {
  const prd = normalizePrdContent(fromAiService)

  it('finds the sections that used to render blank', () => {
    expect(prd.techStack).toHaveLength(1)
    expect(prd.apiDesign).toHaveLength(1)
    expect(prd.databaseSchema).toHaveLength(1)
    expect(prd.teamComposition).toHaveLength(1)
    expect(prd.architecture).toBe('Modular monolith')
  })

  it('reads work packages that arrive as title', () => {
    expect(prd.workPackages.map((w) => w.name)).toEqual(['Backend API', 'Frontend'])
    expect(prd.workPackages[0].requiredSkills).toEqual(['Go'])
    expect(prd.workPackages[0].estimatedHours).toBe(120)
  })

  it('reads sprints that arrive as tasks and duration_days', () => {
    expect(prd.sprintPlan[0].name).toBe('Foundations')
    expect(prd.sprintPlan[0].milestones).toEqual(['Auth'])
    expect(prd.sprintPlan[0].duration).toBe('14 days')
  })

  it('maps dependencies onto the graph the chart reads', () => {
    expect(prd.dependencyGraph).toEqual([
      { from: 'Backend API', to: 'Frontend', type: 'finish_to_start' },
    ])
  })

  // Never emitted under either casing, so the header showed Rp 0.
  it('sums the totals the AI service does not send', () => {
    expect(prd.totalCost).toBe(30_000_000)
    expect(prd.totalEstimatedHours).toBe(200)
  })

  it('agrees with the work package table footer by construction', () => {
    const footer = prd.workPackages.reduce((sum, w) => sum + w.amount, 0)
    expect(prd.totalCost).toBe(footer)
  })
})

describe('camelCase input still works', () => {
  it('reads a document already stored in the viewer shape', () => {
    const prd = normalizePrdContent({
      techStack: [{ category: 'Backend', choice: 'Go' }],
      workPackages: [{ name: 'API', requiredSkills: [], estimatedHours: 10, amount: 1000 }],
      totalCost: 5000,
      teamSize: 3,
    })
    expect(prd.techStack).toHaveLength(1)
    expect(prd.workPackages[0].name).toBe('API')
    // An explicit total wins over the derived one.
    expect(prd.totalCost).toBe(5000)
    expect(prd.teamSize).toBe(3)
  })
})

describe('degenerate input', () => {
  it.each([null, undefined, 'not an object', 42, []])('survives %p', (input) => {
    const prd = normalizePrdContent(input)
    expect(prd.workPackages).toEqual([])
    expect(prd.totalCost).toBe(0)
  })

  it('drops non-object entries rather than rendering undefined', () => {
    const prd = normalizePrdContent({ work_packages: ['nonsense', null, { title: 'Real' }] })
    expect(prd.workPackages).toHaveLength(1)
    expect(prd.workPackages[0].name).toBe('Real')
  })

  it('falls back to the work package count for team size', () => {
    const prd = normalizePrdContent({ work_packages: [{ title: 'A' }, { title: 'B' }] })
    expect(prd.teamSize).toBe(2)
  })
})

/**
 * The fallback builder and the LLM prompt both emit tech_stack as a list of
 * bare strings, api_design and database_schema as prose paragraphs, and
 * team_composition as { team_size, work_packages }. The viewer renders objects
 * with name, description and columns, and a member list with skills and hours,
 * so none of it reached the screen.
 */
const fallbackShape = {
  tech_stack: ['React', 'TypeScript', 'PostgreSQL'],
  architecture: 'Modular monolith with clear service boundaries.',
  api_design: 'RESTful API design with versioned endpoints (/api/v1/*).',
  database_schema: 'Normalized PostgreSQL schema with UUID primary keys.',
  team_composition: {
    team_size: 3,
    work_packages: [
      { title: 'Backend', required_skills: ['Go'], estimated_hours: 100, amount: 15_000_000 },
    ],
  },
}

describe('normalizePrdContent on the fallback shape', () => {
  const prd = normalizePrdContent(fallbackShape)

  it('turns a bare tech string into something the card can render', () => {
    expect(prd.techStack.map((t) => t.name)).toEqual(['React', 'TypeScript', 'PostgreSQL'])
    expect(prd.techStack[0].category).toBe('other')
  })

  it('keeps a prose api design as one entry rather than dropping it', () => {
    expect(prd.apiDesign).toHaveLength(1)
    expect(prd.apiDesign[0].description).toContain('RESTful')
  })

  it('keeps a prose schema description', () => {
    expect(prd.databaseSchema).toHaveLength(1)
    expect(prd.databaseSchema[0].description).toContain('UUID')
  })

  it('reads work packages nested under team_composition', () => {
    expect(prd.workPackages).toHaveLength(1)
    expect(prd.workPackages[0].name).toBe('Backend')
    expect(prd.totalCost).toBe(15_000_000)
  })

  it('builds team members from the work packages', () => {
    expect(prd.teamComposition).toEqual([{ role: 'Backend', skills: ['Go'], estimatedHours: 100 }])
  })

  it('takes team size from the nested block', () => {
    expect(prd.teamSize).toBe(3)
  })
})
