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
      },
    ],
    sprintPlan: [{ name: 'Foundations', duration: '14 days', milestones: ['Auth', 'Schema'] }],
    dependencyGraph: [{ from: 'Backend API', to: 'Frontend', type: 'finish_to_start' }],
    totalCost: 18_000_000,
    teamSize: 1,
    totalEstimatedHours: 120,
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
})
