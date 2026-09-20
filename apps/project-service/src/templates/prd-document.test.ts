import type { PrdContent } from '@kerjacus/shared'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { PrdDocument, type PrdLanguage, type PrdPdfData } from './PrdDocument'

// Structured shape: real endpoints and tables hit the DataTable branch.
function structured(): PrdContent {
  return {
    techStack: [{ name: 'React', category: 'frontend', description: 'SPA' }],
    architecture: 'Modular monolith with clear service boundaries.',
    apiDesign: [{ method: 'GET', path: '/projects', description: 'List projects' }],
    databaseSchema: [{ name: 'projects', description: 'Project rows', columns: 12 }],
    teamComposition: [{ role: 'Backend', skills: ['Go'], estimatedHours: 120 }],
    workPackages: [
      {
        name: 'Backend API',
        requiredSkills: ['Go'],
        estimatedHours: 120,
        amount: 18_000_000,
        dependencies: [],
        deliverables: [{ title: 'REST API', type: 'code', expected: 'All endpoints implemented' }],
        acceptanceCriteria: ['Integration tests pass'],
        tracesTo: ['FR-001'],
      },
    ],
    sprintPlan: [{ name: 'Foundations', duration: '14 days', milestones: ['Auth', 'Schema'] }],
    dependencyGraph: [{ from: 'Backend API', to: 'Frontend', type: 'finish_to_start' }],
    assumptions: ['Owner supplies branding before sprint 1'],
    risks: ['Risk: scope creep | Mitigation: change requests re-estimated'],
    totalCost: 18_000_000,
    teamSize: 1,
    totalEstimatedHours: 120,
    estimatedTimelineDays: 20,
    traceability: {
      requirementCount: 2,
      coveredCount: 1,
      coveragePercent: 50,
      uncoveredRequirements: ['FR-002'],
      untracedWorkPackages: ['Frontend polish'],
    },
  }
}

// Prose shape: empty paths and zero columns hit the prose fallback branch.
function prose(): PrdContent {
  return {
    ...structured(),
    apiDesign: [
      { method: 'REST', path: '', description: 'Versioned REST endpoints under /api/v1.' },
    ],
    databaseSchema: [{ name: 'Schema', description: 'Normalized schema, UUID keys.', columns: 0 }],
    dependencyGraph: [],
  }
}

function sample(language: PrdLanguage, content: PrdContent, watermark?: string): PrdPdfData {
  return {
    projectTitle: 'Marketplace Revamp',
    language,
    generatedAt: '24 Juli 2026',
    version: 1,
    watermark,
    content,
  }
}

async function render(data: PrdPdfData): Promise<Buffer> {
  return (await renderToBuffer(PrdDocument({ data }) as never)) as Buffer
}

describe('PrdDocument', () => {
  it('renders a valid PDF in Indonesian', async () => {
    const buf = await render(sample('id', structured()))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })

  it('renders a valid PDF in English', async () => {
    const buf = await render(sample('en', structured()))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders the prose fallback branch', async () => {
    const buf = await render(sample('id', prose()))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders the preview watermark without failing', async () => {
    const buf = await render(sample('id', structured(), 'PRATINJAU - KerjaCUS!'))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  /**
   * The work-package detail section renders four independent optional blocks
   * and a package qualifies for it by having deliverables OR acceptance
   * criteria. A package with only one of the two therefore has to skip the
   * other's heading and list rather than emit an empty one, and the model does
   * omit `expected` and `duration` - they are optional in the PRD schema.
   *
   * Every sample above supplies all of it, so the whole omitted-field half of
   * this section had never rendered. It is the half a real generation hits
   * first, since a model that fills every optional field is the exception.
   */
  it('renders packages and sprints that omit the optional fields', async () => {
    const content: PrdContent = {
      ...structured(),
      workPackages: [
        {
          name: 'Deliverables only',
          requiredSkills: ['Go'],
          estimatedHours: 40,
          amount: 6_000_000,
          dependencies: [],
          // No `expected`: the list falls back to the bare title.
          deliverables: [{ title: 'REST API', type: 'code' }],
          acceptanceCriteria: [],
          tracesTo: [],
        },
        {
          name: 'Acceptance only',
          requiredSkills: ['React'],
          estimatedHours: 20,
          amount: 3_000_000,
          dependencies: [],
          deliverables: [],
          acceptanceCriteria: ['Lighthouse score above 90'],
          tracesTo: [],
        },
      ],
      sprintPlan: [{ name: 'Hardening', milestones: ['Load test'] }],
    }

    const buf = await render(sample('id', content))

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })

  /**
   * The paid download must not hold less than the free preview. Team
   * composition, the timeline estimate, the traceability report and the
   * per-package trace all reached the reader before they reached the PDF, so
   * each is pinned to a length comparison rather than to "renders at all".
   */
  it('prints the team composition the preview shows', async () => {
    const data = sample('id', structured())
    const full = await render(data)
    const without = await render({
      ...data,
      content: { ...data.content, teamComposition: [] },
    })
    expect(without.length).toBeLessThan(full.length)
  })

  it('prints the traceability report, and omits it with no requirements', async () => {
    const data = sample('id', structured())
    const full = await render(data)
    const without = await render({
      ...data,
      content: {
        ...data.content,
        traceability: {
          requirementCount: 0,
          coveredCount: 0,
          coveragePercent: 0,
          uncoveredRequirements: [],
          untracedWorkPackages: [],
        },
      },
    })
    expect(without.length).toBeLessThan(full.length)
  })

  it('prints the requirements a work package traces to', async () => {
    const data = sample('id', structured())
    const full = await render(data)
    const without = await render({
      ...data,
      content: {
        ...data.content,
        workPackages: data.content.workPackages.map((w) => ({ ...w, tracesTo: [] })),
      },
    })
    expect(without.length).toBeLessThan(full.length)
  })

  /** Full coverage renders the headline without the two gap lists. */
  it('renders a fully covered traceability report', async () => {
    const buf = await render(
      sample('en', {
        ...structured(),
        traceability: {
          requirementCount: 2,
          coveredCount: 2,
          coveragePercent: 100,
          uncoveredRequirements: [],
          untracedWorkPackages: [],
        },
      }),
    )
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
