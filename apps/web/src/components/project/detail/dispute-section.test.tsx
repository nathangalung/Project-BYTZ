// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { DisputeSection } from './dispute-section'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Dispute = {
  id: string
  status: string
  reason: string
  createdAt: string
  evidenceUrls?: string[]
  resolution?: string | null
  resolutionType?: string | null
  resolvedAt?: string | null
}

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'd-1',
    status: 'open',
    reason: 'Deliverable tidak sesuai spesifikasi PRD',
    createdAt: '2026-08-13T00:00:00.000Z',
    evidenceUrls: [],
    resolution: null,
    resolutionType: null,
    resolvedAt: null,
    ...overrides,
  }
}

/** Never resolves, so the component stays in its loading state. */
function stubPending() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
}

function stubDisputes(disputes: Dispute[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: disputes }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DisputeSection projectId="p-1" />
    </QueryClientProvider>,
  )
}

describe('DisputeSection', () => {
  /**
   * The four-state contract. Loading first, so the panel does not flash an
   * empty "no disputes" that is contradicted a moment later - on a project
   * that does have one, that reads as the dispute having been dropped.
   */
  it('shows a busy indicator while the disputes are loading', () => {
    stubPending()
    const { container } = renderSection()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('Tidak ada sengketa aktif untuk proyek ini')).toBeNull()
  })

  it('says so when there are none', async () => {
    stubDisputes([])
    renderSection()

    expect(await screen.findByText('Tidak ada sengketa aktif untuk proyek ini')).toBeDefined()
  })

  it('shows the reason and the translated status of each dispute', async () => {
    stubDisputes([dispute()])
    renderSection()

    expect(await screen.findByText('Deliverable tidak sesuai spesifikasi PRD')).toBeDefined()
    expect(screen.getByText('13 Agustus 2026')).toBeDefined()
    expect(screen.queryByText('open')).toBeNull()
  })

  it('lists every dispute rather than only the first', async () => {
    stubDisputes([dispute(), dispute({ id: 'd-2', reason: 'Talenta tidak responsif' })])
    renderSection()

    expect(await screen.findByText('Talenta tidak responsif')).toBeDefined()
    expect(screen.getByText('Deliverable tidak sesuai spesifikasi PRD')).toBeDefined()
  })

  describe('the evidence links', () => {
    /**
     * Evidence lives in storage, so the links open in a new tab and must not
     * hand the opener over.
     */
    it('numbers each attachment and opens it safely', async () => {
      stubDisputes([
        dispute({ evidenceUrls: ['https://files.example/a.png', 'https://files.example/b.png'] }),
      ])
      renderSection()

      const links = await screen.findAllByRole('link')
      expect(links).toHaveLength(2)
      expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
      expect(links[0].getAttribute('target')).toBe('_blank')
      expect(links[0].textContent).not.toBe(links[1].textContent)
    })

    it('shows nothing when there is no evidence', async () => {
      stubDisputes([dispute({ evidenceUrls: [] })])
      renderSection()

      await screen.findByText('Deliverable tidak sesuai spesifikasi PRD')
      expect(screen.queryAllByRole('link')).toHaveLength(0)
    })

    it('survives a dispute row with no evidence field at all', async () => {
      stubDisputes([dispute({ evidenceUrls: undefined })])
      renderSection()

      await screen.findByText('Deliverable tidak sesuai spesifikasi PRD')
      expect(screen.queryAllByRole('link')).toHaveLength(0)
    })
  })

  describe('a resolved dispute', () => {
    /**
     * The decision at step 3 is binding, so the outcome is what the parties
     * come back to read. Showing the resolved status without the reasoning
     * would leave the losing side with no record of why.
     */
    it('shows the outcome and the reasoning behind it', async () => {
      stubDisputes([
        dispute({
          status: 'resolved',
          resolution: 'Dana dibagi 70-30 sesuai progres yang diverifikasi',
          resolutionType: 'split',
          resolvedAt: '2026-08-20T00:00:00.000Z',
        }),
      ])
      renderSection()

      expect(
        await screen.findByText('Dana dibagi 70-30 sesuai progres yang diverifikasi'),
      ).toBeDefined()
      expect(screen.getByText('20 Agustus 2026', { exact: false })).toBeDefined()
    })

    it('shows no outcome block while the dispute is still open', async () => {
      stubDisputes([dispute({ status: 'open', resolution: 'tidak seharusnya terlihat' })])
      renderSection()

      await screen.findByText('Deliverable tidak sesuai spesifikasi PRD')
      expect(screen.queryByText('tidak seharusnya terlihat')).toBeNull()
    })

    it('shows no outcome block when the resolution text is missing', async () => {
      stubDisputes([dispute({ status: 'resolved', resolution: null, resolutionType: 'split' })])
      renderSection()

      await screen.findByText('Deliverable tidak sesuai spesifikasi PRD')
      expect(screen.queryByText(/dibagi/)).toBeNull()
    })

    it.each(['funds_to_talent', 'funds_to_owner', 'split'])(
      'names the %s outcome',
      async (resolutionType) => {
        stubDisputes([
          dispute({ status: 'resolved', resolution: 'Keputusan final', resolutionType }),
        ])
        renderSection()

        await screen.findByText('Keputusan final')
        expect(screen.queryByText(resolutionType)).toBeNull()
      },
    )
  })

  /**
   * The status set is an enum that grows with the dispute process. Falling
   * back to the open styling keeps an unrecognised status rendering rather
   * than producing an undefined class string.
   */
  it('falls back for a status it does not recognise', async () => {
    stubDisputes([dispute({ status: 'arbitration' })])
    renderSection()

    expect(await screen.findByText('Deliverable tidak sesuai spesifikasi PRD')).toBeDefined()
  })
})
