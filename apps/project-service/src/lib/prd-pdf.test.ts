import { normalizePrdContent } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { prdLanguage, renderPrdPdf } from './prd-pdf'

describe('prdLanguage', () => {
  it('picks English only when explicitly en', () => {
    expect(prdLanguage({ language: 'en' })).toBe('en')
  })

  it('defaults to Indonesian', () => {
    expect(prdLanguage({ language: 'id' })).toBe('id')
    expect(prdLanguage({})).toBe('id')
    expect(prdLanguage(null)).toBe('id')
    expect(prdLanguage('nonsense')).toBe('id')
  })
})

describe('renderPrdPdf', () => {
  it('renders stored AI content through the shared normalizer', async () => {
    const content = normalizePrdContent({
      tech_stack: ['React'],
      architecture: 'Modular monolith.',
      work_packages: [
        { title: 'API', required_skills: ['Go'], estimated_hours: 100, amount: 15_000_000 },
      ],
    })
    const buf = await renderPrdPdf({
      projectTitle: 'Test',
      content,
      language: 'id',
      generatedAt: '24 Juli 2026',
      version: 1,
    })
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
