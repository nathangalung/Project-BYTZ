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

  /**
   * A failed model call used to return a three-field stub built from the
   * project description, which the route then stored as the owner's BRD. It
   * looked like a document, it counted against the one free document per day,
   * and nothing anywhere said it was not generated. The AI key has never been
   * valid, so every BRD produced so far came out of that branch.
   */
  it('refuses to invent a document when the AI service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )
    await expect(
      generateBrdContent({ projectId: 'p-1', project, conversationHistory: [], language: 'id' }),
    ).rejects.toThrow(/unavailable/i)
  })

  it('refuses to invent a document when the AI service returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream boom', { status: 502 })),
    )
    await expect(
      generateBrdContent({ projectId: 'p-1', project, conversationHistory: [], language: 'id' }),
    ).rejects.toThrow(/unavailable/i)
  })

  it('refuses an empty document body as if it were generated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ brd: {} }))),
    )
    await expect(
      generateBrdContent({ projectId: 'p-1', project, conversationHistory: [], language: 'id' }),
    ).rejects.toThrow(/unavailable/i)
  })

  /**
   * ai-service answers `{brd: ...}` on some routes and the shared
   * `{success, data: {brd: ...}}` envelope on others, and which one a route
   * uses has changed. unwrap() reads both; only the bare form was ever tested,
   * so an ai-service that standardised on the envelope would have started
   * refusing every generation as "empty document" with the body sitting right
   * there in the response.
   */
  it('reads the document out of the shared data envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ success: true, data: { brd: { scope: 'x' } } })),
      ),
    )

    expect(
      await generateBrdContent({
        projectId: 'p-1',
        project,
        conversationHistory: [],
        language: 'id',
      }),
    ).toEqual({ scope: 'x' })
  })

  it('refuses a response carrying neither the key nor the envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ unexpected: true }))),
    )

    await expect(
      generateBrdContent({ projectId: 'p-1', project, conversationHistory: [], language: 'id' }),
    ).rejects.toThrow(/empty document/i)
  })

  /**
   * template_score rides alongside the document rather than inside it, and it
   * is what the route stores to tell a templated generation from a bespoke
   * one. It arrives in both envelope shapes.
   */
  it('folds the template score into the document from either shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ brd: { scope: 'x' }, template_score: 0.8 }))),
    )
    expect(
      await generateBrdContent({
        projectId: 'p-1',
        project,
        conversationHistory: [],
        language: 'id',
      }),
    ).toEqual({ scope: 'x', template_score: 0.8 })

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { brd: { scope: 'y' }, template_score: 0.4 } })),
      ),
    )
    expect(
      await generateBrdContent({
        projectId: 'p-1',
        project,
        conversationHistory: [],
        language: 'id',
      }),
    ).toEqual({ scope: 'y', template_score: 0.4 })
  })

  /**
   * Everything serviceFetch raises is an UpstreamError, but the request body is
   * built inside the same try, so a value that will not serialise fails here
   * instead. It has to come back as the same refusal the owner already
   * understands - not as a raw TypeError escaping into the route's 500 - or the
   * claim released above it would be the only thing that ran.
   */
  it('reports a local serialisation failure as an unavailability, not a crash', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ brd: { scope: 'x' } }))),
    )

    await expect(
      generateBrdContent({
        projectId: 'p-1',
        project,
        conversationHistory: [],
        language: 'id',
        currentDocument: circular,
      }),
    ).rejects.toThrow(/unavailable/i)
  })

  it('reports a non-Error failure without interpolating undefined into the reason', async () => {
    const hostile = {
      toJSON() {
        throw 'not an Error'
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ brd: { scope: 'x' } }))),
    )

    await expect(
      generateBrdContent({
        projectId: 'p-1',
        project,
        conversationHistory: [],
        language: 'id',
        currentDocument: hostile as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(/request failed/)
  })
})
