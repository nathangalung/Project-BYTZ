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

describe('deliverables, acceptance criteria, assumptions and risks', () => {
  it('reads them off a work package and the document', () => {
    const prd = normalizePrdContent({
      work_packages: [
        {
          title: 'Backend',
          deliverables: [{ title: 'API', type: 'code', expected: 'All endpoints' }],
          acceptance_criteria: ['Integration tests pass'],
        },
      ],
      assumptions: ['Owner supplies branding'],
      risks: ['Risk: scope creep | Mitigation: change requests'],
    })
    const wp = prd.workPackages[0]
    expect(wp.deliverables).toEqual([{ title: 'API', type: 'code', expected: 'All endpoints' }])
    expect(wp.acceptanceCriteria).toEqual(['Integration tests pass'])
    expect(prd.assumptions).toEqual(['Owner supplies branding'])
    expect(prd.risks).toEqual(['Risk: scope creep | Mitigation: change requests'])
  })

  it('defaults a bare-string deliverable type to document and empties missing lists', () => {
    const prd = normalizePrdContent({
      work_packages: [{ title: 'Design', deliverables: [{ title: 'Figma' }] }],
    })
    expect(prd.workPackages[0].deliverables[0]).toEqual({
      title: 'Figma',
      type: 'document',
      expected: '',
    })
    expect(prd.workPackages[0].acceptanceCriteria).toEqual([])
    expect(prd.assumptions).toEqual([])
    expect(prd.risks).toEqual([])
  })
})

/**
 * The outer lookups accept either spelling, the nested ones did not. The AI
 * writes team_composition.work_packages, the seed writes
 * teamComposition.workPackages, and only the first was ever read - so all 25
 * seeded projects rendered a PRD with no work packages, no team, Rp 0 and
 * 0 hours, which reads as a failed generation rather than as a demo.
 */
describe('normalizePrdContent nested team composition', () => {
  const nested = (team: Record<string, unknown>) =>
    normalizePrdContent({ architecture: 'x', teamComposition: team })

  it('reads work packages nested under either spelling', () => {
    const snake = nested({
      team_size: 2,
      work_packages: [{ title: 'Backend', estimated_hours: 40, amount: 5_000_000 }],
    })
    const camel = nested({
      teamSize: 2,
      workPackages: [{ title: 'Backend', estimatedHours: 40, amount: 5_000_000 }],
    })
    expect(snake.workPackages).toHaveLength(1)
    expect(camel.workPackages).toHaveLength(1)
    expect(camel.workPackages[0]?.name).toBe('Backend')
    expect(camel.totalCost).toBe(5_000_000)
    expect(camel.totalEstimatedHours).toBe(40)
  })

  it('reads the team size nested under either spelling', () => {
    expect(nested({ team_size: 3, work_packages: [] }).teamSize).toBe(3)
    expect(nested({ teamSize: 3, workPackages: [] }).teamSize).toBe(3)
  })
})

/**
 * The fields the model declines to write.
 *
 * The prompt asks for a shape and the model answers with a subset of it, so
 * every default below stands in for something that was simply absent. These
 * are the branches that decide whether a partial answer renders as a readable
 * document or as a row of blanks, and none of them can be reached by feeding
 * the normaliser a complete PRD.
 */
describe('normalizePrdContent supplies what the model omitted', () => {
  it('numbers a nameless sprint by its position in the plan', () => {
    const prd = normalizePrdContent({ sprint_plan: [{ tasks: ['Auth'] }] })

    expect(prd.sprintPlan[0]?.name).toBe('Sprint 1')
    expect(prd.sprintPlan[0]?.milestones).toEqual(['Auth'])
    // Neither duration nor duration_days: blank, not "undefined days".
    expect(prd.sprintPlan[0]?.duration).toBe('')
  })

  it('prefers the sprint number the model did write over the position', () => {
    const prd = normalizePrdContent({ sprint_plan: [{ sprint_number: 7 }] })

    expect(prd.sprintPlan[0]?.name).toBe('Sprint 7')
  })

  it('defaults a tech entry with no category to other', () => {
    const prd = normalizePrdContent({ tech_stack: [{ name: 'Redis' }] })

    expect(prd.techStack[0]).toEqual({
      name: 'Redis',
      category: 'other',
      description: '',
      recommended: false,
    })
  })

  it('labels an endpoint whose method the model left out', () => {
    const prd = normalizePrdContent({ api_design: [{ path: '/api/v1/projects' }] })

    expect(prd.apiDesign[0]).toEqual({
      method: 'ANY',
      path: '/api/v1/projects',
      description: '',
    })
  })

  /**
   * columns is a count in the prompt and a list in about half the answers.
   * Counting the list is the difference between a schema card reading "3
   * columns" and reading "0 columns" beside three named columns.
   */
  it('counts a column list the model wrote out instead of totalling', () => {
    const prd = normalizePrdContent({
      database_schema: [{ name: 'users', columns: ['id', 'email', 'created_at'] }],
    })

    expect(prd.databaseSchema[0]?.name).toBe('users')
    expect(prd.databaseSchema[0]?.columns).toBe(3)
  })

  it('assumes finish_to_start for a dependency with no type', () => {
    const prd = normalizePrdContent({ dependencies: [{ from: 'Backend', to: 'Frontend' }] })

    expect(prd.dependencyGraph[0]).toEqual({
      from: 'Backend',
      to: 'Frontend',
      type: 'finish_to_start',
    })
  })

  /**
   * A null inside tech_stack survives as an empty card, because that array is
   * mapped straight through while every other list in the file goes via
   * `list()` and drops non-objects. Asserted as it stands rather than as it
   * ought to be; the mismatch is reported separately.
   */
  it('turns a null tech entry into a blank card rather than throwing', () => {
    const prd = normalizePrdContent({ tech_stack: [null] })

    expect(prd.techStack).toEqual([
      { name: '', category: 'other', description: '', recommended: false },
    ])
  })
})
