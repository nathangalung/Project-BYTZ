// @vitest-environment jsdom
import type { BrdContent } from '@kerjacus/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { BrdDocumentBody, BrdSection, BrdTemplateScorePanel } from './brd-document-body'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

function content(overrides: Partial<BrdContent> = {}): BrdContent {
  return {
    executiveSummary: 'Marketplace untuk UMKM lokal',
    businessObjectives: ['Menaikkan penjualan', 'Menjangkau pasar baru'],
    successMetrics: ['1000 transaksi per bulan'],
    scope: 'Katalog, keranjang, pembayaran',
    outOfScope: ['Aplikasi mobile native'],
    functionalRequirements: [{ title: 'Katalog produk', content: 'Daftar dan cari produk' }],
    nonFunctionalRequirements: ['Waktu muat di bawah 2 detik'],
    estimatedPriceMin: 10_000_000,
    estimatedPriceMax: 20_000_000,
    estimatedTimelineDays: 60,
    estimatedTeamSize: 3,
    riskAssessment: ['Risk: Scope melebar | Mitigation: Kunci scope di PRD'],
    ...overrides,
  }
}

describe('BrdDocumentBody', () => {
  describe('the paywall', () => {
    /**
     * The whole BRD is readable before payment; the watermark is what marks
     * every screenful so a screenshot carries the label. Hiding the content
     * instead would be a different product decision, and showing it clean
     * before payment gives the paid unlock away.
     */
    it('watermarks an unpaid document', () => {
      const { container } = render(<BrdDocumentBody content={content()} isUnlocked={false} />)

      const watermark = container.querySelector('[aria-hidden="true"].pointer-events-none')
      expect(watermark).not.toBeNull()
    })

    it('leaves a paid document clean', () => {
      const { container } = render(<BrdDocumentBody content={content()} isUnlocked />)

      expect(container.querySelector('[aria-hidden="true"].pointer-events-none')).toBeNull()
    })

    it('shows the document itself either way', () => {
      render(<BrdDocumentBody content={content()} isUnlocked={false} />)

      expect(screen.getByText('Marketplace untuk UMKM lokal')).toBeDefined()
    })
  })

  describe('the sections', () => {
    /**
     * Progressive disclosure: only the summary, the requirements and the
     * estimate open by default, so the reader meets three sections rather than
     * nine walls of text.
     */
    it('opens the summary, the requirements and the estimate', () => {
      render(<BrdDocumentBody content={content()} isUnlocked />)

      expect(screen.getByText('Marketplace untuk UMKM lokal')).toBeDefined()
      expect(screen.getByText('Katalog produk')).toBeDefined()
      expect(screen.getByText('Rp 10.000.000')).toBeDefined()
    })

    it('leaves the rest collapsed until asked', async () => {
      const user = userEvent.setup()
      render(<BrdDocumentBody content={content()} isUnlocked />)

      expect(screen.queryByText('Menaikkan penjualan')).toBeNull()

      await user.click(screen.getByRole('button', { name: /Tujuan Bisnis|Business Objectives/ }))

      expect(screen.getByText('Menaikkan penjualan')).toBeDefined()
    })

    it('omits the success metrics section when the AI returned none', () => {
      render(<BrdDocumentBody content={content({ successMetrics: [] })} isUnlocked />)

      const headings = screen.getAllByRole('button').map((b) => b.textContent)
      expect(headings.some((h) => h?.includes('Metrik'))).toBe(false)
    })

    it('includes it when there are some', () => {
      render(<BrdDocumentBody content={content()} isUnlocked />)

      const headings = screen.getAllByRole('button').map((b) => b.textContent)
      expect(headings.some((h) => h?.includes('Metrik'))).toBe(true)
    })
  })

  it('formats the price estimate as currency and the rest as counts', () => {
    render(<BrdDocumentBody content={content()} isUnlocked />)

    expect(screen.getByText('Rp 10.000.000')).toBeDefined()
    expect(screen.getByText('Rp 20.000.000')).toBeDefined()
    expect(screen.getByText('60')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
  })

  describe('the risk assessment', () => {
    /**
     * The AI writes each risk as "Risk: ... | Mitigation: ...". Splitting it
     * is what puts the mitigation on its own line instead of leaving the
     * reader a run-on with a pipe in the middle.
     */
    it('splits the risk from its mitigation', async () => {
      const user = userEvent.setup()
      render(<BrdDocumentBody content={content()} isUnlocked />)

      await user.click(screen.getByRole('button', { name: /Risiko|Risk/ }))

      expect(screen.getByText('Scope melebar')).toBeDefined()
      expect(screen.getByText('Kunci scope di PRD')).toBeDefined()
      expect(screen.queryByText(/\|/)).toBeNull()
    })

    it('renders a risk written without a mitigation', async () => {
      const user = userEvent.setup()
      render(
        <BrdDocumentBody
          content={content({ riskAssessment: ['Timeline terlalu ketat'] })}
          isUnlocked
        />,
      )

      await user.click(screen.getByRole('button', { name: /Risiko|Risk/ }))

      expect(screen.getByText('Timeline terlalu ketat')).toBeDefined()
    })
  })
})

describe('BrdSection', () => {
  it('reports whether it is open to assistive technology', async () => {
    const user = userEvent.setup()
    render(
      <BrdSection icon={<span />} title="Ruang Lingkup">
        <p>Isi bagian</p>
      </BrdSection>,
    )

    const toggle = screen.getByRole('button', { name: 'Ruang Lingkup' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await user.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps its body out of the document while collapsed', () => {
    render(
      <BrdSection icon={<span />} title="Ruang Lingkup">
        <p>Isi bagian</p>
      </BrdSection>,
    )

    expect(screen.queryByText('Isi bagian')).toBeNull()
  })

  it('starts open when the caller asks', () => {
    render(
      <BrdSection icon={<span />} title="Ruang Lingkup" defaultOpen>
        <p>Isi bagian</p>
      </BrdSection>,
    )

    expect(screen.getByText('Isi bagian')).toBeDefined()
  })

  it('collapses again on a second press', async () => {
    const user = userEvent.setup()
    render(
      <BrdSection icon={<span />} title="Ruang Lingkup" defaultOpen>
        <p>Isi bagian</p>
      </BrdSection>,
    )

    await user.click(screen.getByRole('button', { name: 'Ruang Lingkup' }))

    expect(screen.queryByText('Isi bagian')).toBeNull()
  })
})

describe('BrdTemplateScorePanel', () => {
  it('shows the overall completeness', () => {
    render(<BrdTemplateScorePanel score={{ overall: 72, sections: [] }} />)

    expect(screen.getByText('72%')).toBeDefined()
  })

  /**
   * The bands are the signal the owner acts on: green means the draft is ready
   * to approve, red means it needs more scoping. The boundaries are 80 and 50,
   * so those exact values are where a wrong comparison shows.
   */
  it.each([
    [80, 'text-success-600'],
    [79, 'text-accent-cream-600'],
    [50, 'text-accent-cream-600'],
    [49, 'text-accent-coral-600'],
  ])('bands a score of %i', (overall, expectedClass) => {
    render(<BrdTemplateScorePanel score={{ overall, sections: [] }} />)

    expect(screen.getByText(`${String(overall)}%`).className).toContain(expectedClass)
  })

  it('shows no breakdown when there are no per-section scores', () => {
    const { container } = render(<BrdTemplateScorePanel score={{ overall: 90, sections: [] }} />)

    expect(container.querySelectorAll('.h-1\\.5')).toHaveLength(0)
  })

  it('lists each section with its own score', () => {
    render(
      <BrdTemplateScorePanel
        score={{
          overall: 60,
          sections: [
            { section: 'A', label: 'Ringkasan', score: 90 },
            { section: 'B', label: 'Lingkup', score: 30, reason: 'Terlalu singkat' },
          ],
        }}
      />,
    )

    expect(screen.getByText('Ringkasan')).toBeDefined()
    expect(screen.getByText('90%')).toBeDefined()
    expect(screen.getByText('Terlalu singkat')).toBeDefined()
  })

  it('omits the reason line for a section that has none', () => {
    render(
      <BrdTemplateScorePanel
        score={{ overall: 60, sections: [{ section: 'A', label: 'Ringkasan', score: 90 }] }}
      />,
    )

    expect(screen.getByText('Ringkasan')).toBeDefined()
    expect(screen.queryByText('Terlalu singkat')).toBeNull()
  })

  it('sizes the overall bar to the score', () => {
    const { container } = render(<BrdTemplateScorePanel score={{ overall: 42, sections: [] }} />)

    expect((container.querySelector('.h-2 > div') as HTMLElement).style.width).toBe('42%')
  })
})
