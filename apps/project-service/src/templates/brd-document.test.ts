import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { BrdDocument, type BrdLanguage, type BrdPdfData } from './BrdDocument'

function sample(language: BrdLanguage, watermark?: string): BrdPdfData {
  return {
    projectTitle: 'Marketplace Revamp',
    language,
    generatedAt: '24 Juli 2026',
    version: 1,
    watermark,
    content: {
      executiveSummary: 'Rebuild the checkout flow to lift conversion.',
      businessObjectives: ['Raise conversion', 'Cut abandonment'],
      successMetrics: ['Conversion up 20 percent'],
      scope: 'Web and API.',
      outOfScope: ['Native mobile app'],
      stakeholders: [{ title: 'Product Owner', content: 'Signs off on scope.' }],
      targetUsers: [{ title: 'Returning buyer', content: 'Checks out in under a minute.' }],
      businessRules: ['Prices include VAT'],
      expectedBenefits: ['Support cost down 15 percent'],
      timelinePhases: [{ title: 'Phase 1', content: 'Checkout rebuild.' }],
      functionalRequirements: [
        { title: 'Checkout', content: 'One-page checkout with saved addresses.' },
        { title: 'Payments', content: 'Midtrans VA, QRIS, e-wallet.' },
      ],
      nonFunctionalRequirements: ['P95 under 500ms', 'OWASP security'],
      estimatedPriceMin: 15_000_000,
      estimatedPriceMax: 25_000_000,
      estimatedTimelineDays: 60,
      estimatedTeamSize: 3,
      riskAssessment: ['Tight timeline for the scope'],
    },
  }
}

async function render(data: BrdPdfData): Promise<Buffer> {
  return (await renderToBuffer(BrdDocument({ data }) as never)) as Buffer
}

describe('BrdDocument', () => {
  /**
   * The paid download must not hold less than the free preview. The five late
   * template sections reached the reader before they reached the PDF once.
   */
  it('omits a template section the document left open', async () => {
    const data = sample('en')
    const full = await render(data)
    const withoutPhases = await render({
      ...data,
      content: { ...data.content, timelinePhases: [], businessRules: [] },
    })
    expect(withoutPhases.length).toBeLessThan(full.length)
  })

  it('renders when an older row carries none of the late sections', async () => {
    const data = sample('id')
    const legacy = { ...data.content } as Record<string, unknown>
    for (const key of [
      'stakeholders',
      'targetUsers',
      'businessRules',
      'expectedBenefits',
      'timelinePhases',
    ]) {
      delete legacy[key]
    }
    const buf = await render({ ...data, content: legacy as typeof data.content })
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders a valid PDF in Indonesian', async () => {
    const buf = await render(sample('id'))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })

  it('renders a valid PDF in English', async () => {
    const buf = await render(sample('en'))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders the preview watermark without failing', async () => {
    const buf = await render(sample('id', 'PRATINJAU - KerjaCUS!'))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
