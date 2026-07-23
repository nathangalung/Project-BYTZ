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
