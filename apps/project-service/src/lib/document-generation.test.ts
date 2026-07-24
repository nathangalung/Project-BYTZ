import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateBrdContent, priceBrd, pricePrd } from './document-generation'

describe('priceBrd', () => {
  it('is 5 percent of the estimate midpoint', () => {
    expect(priceBrd({ estimated_price_min: 20_000_000, estimated_price_max: 40_000_000 })).toBe(
      1_500_000,
    )
  })

  it('floors at the default when the estimate is missing or tiny', () => {
    expect(priceBrd({})).toBe(99_000)
    expect(priceBrd({ estimated_price_min: 1000, estimated_price_max: 2000 })).toBe(99_000)
  })
})

describe('pricePrd', () => {
  it('is 8 percent of the estimate midpoint', () => {
    expect(pricePrd({ estimated_price_min: 20_000_000, estimated_price_max: 40_000_000 })).toBe(
      2_400_000,
    )
  })

  it('floors at the default when the estimate is missing', () => {
    expect(pricePrd({})).toBe(199_000)
  })
})

const project = {
  title: 'Test',
  description: 'desc',
  category: 'web_app',
  budgetMin: 10_000_000,
  budgetMax: 20_000_000,
  estimatedTimelineDays: 60,
}

describe('generateBrdContent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the revision instruction and current document', async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init: RequestInit) =>
        new Response(JSON.stringify({ brd: { scope: 'new' } })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const content = await generateBrdContent({
      projectId: 'p-1',
      project,
      conversationHistory: [],
      language: 'id',
      currentDocument: { scope: 'old' },
      revisionInstruction: 'Add loyalty',
    })

    expect(content).toEqual({ scope: 'new' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.revision_instruction).toBe('Add loyalty')
    expect(body.current_document).toEqual({ scope: 'old' })
    expect(body.language).toBe('id')
  })

  it('falls back to a minimal document when the AI call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )
    const content = await generateBrdContent({
      projectId: 'p-1',
      project,
      conversationHistory: [],
      language: 'id',
    })
    expect(content.executive_summary).toContain('Test')
  })
})
