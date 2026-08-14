// @vitest-environment jsdom
import { ProjectVisibility } from '@kerjacus/shared'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import type { FormData } from './shared'
import { ReviewItem, Step4Review } from './step-review'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const t = i18n.getFixedT('id', 'project')

function form(overrides: Partial<FormData> = {}): FormData {
  return {
    title: 'Marketplace UMKM',
    description: 'Toko online untuk UMKM lokal',
    category: 'web_app',
    budgetMin: '10000000',
    budgetMax: '50000000',
    estimatedTimelineDays: '60',
    deadline: '',
    almamater: '',
    minExperience: '',
    requiredSkills: [],
    visibility: ProjectVisibility.PUBLIC_SUMMARY,
    documentFileKey: '',
    documentType: '',
    ...overrides,
  }
}

describe('Step4Review', () => {
  /**
   * This is the last screen before the project is created, so it has to show
   * what will actually be sent. A field the owner filled in and cannot see
   * here is one they cannot correct before it is committed.
   */
  it('repeats the basics back to the owner', () => {
    render(<Step4Review form={form()} t={t} />)

    expect(screen.getByText('Marketplace UMKM')).toBeDefined()
    expect(screen.getByText('Toko online untuk UMKM lokal')).toBeDefined()
    expect(screen.getByText('Web App')).toBeDefined()
  })

  /**
   * The budget is stored as raw digits and shown here as currency. Rendering
   * the raw string would show "10000000", which is the figure the owner has to
   * check before committing to it.
   */
  it('formats the budget as currency rather than raw digits', () => {
    render(<Step4Review form={form()} t={t} />)

    expect(screen.getByText('Rp 10.000.000')).toBeDefined()
    expect(screen.getByText('Rp 50.000.000')).toBeDefined()
    expect(screen.queryByText('10000000')).toBeNull()
  })

  it('spells out the timeline unit', () => {
    render(<Step4Review form={form()} t={t} />)

    expect(screen.getByText('60 hari')).toBeDefined()
  })

  describe('the optional rows', () => {
    it('says a preference is unset rather than leaving it blank', () => {
      render(<Step4Review form={form()} t={t} />)

      expect(screen.getAllByText('Tidak ditentukan')).toHaveLength(3)
    })

    it('shows the preferences that were filled in', () => {
      render(
        <Step4Review
          form={form({ almamater: 'ITB', minExperience: '3', requiredSkills: ['React'] })}
          t={t}
        />,
      )

      expect(screen.getByText('ITB')).toBeDefined()
      expect(screen.getByText('3 tahun')).toBeDefined()
      expect(screen.getByText('React')).toBeDefined()
      expect(screen.queryByText('Tidak ditentukan')).toBeNull()
    })

    it('omits the deadline row when none was set', () => {
      render(<Step4Review form={form()} t={t} />)

      expect(screen.queryByText('Deadline')).toBeNull()
    })

    it('shows the deadline row when one was set', () => {
      render(<Step4Review form={form({ deadline: '2026-12-31' })} t={t} />)

      expect(screen.getByText('Deadline')).toBeDefined()
      expect(screen.getByText('2026-12-31')).toBeDefined()
    })

    it.each([
      ['brd', 'BRD'],
      ['prd', 'PRD'],
      ['both', 'BRD & PRD'],
    ] as const)('spells out the %s document choice', (documentType, expected) => {
      render(<Step4Review form={form({ documentType })} t={t} />)

      expect(screen.getByText(expected)).toBeDefined()
    })

    it('omits the document row when nothing was chosen', () => {
      render(<Step4Review form={form()} t={t} />)

      expect(screen.queryByText('Tipe Dokumen')).toBeNull()
    })

    it('confirms an uploaded brief', () => {
      render(<Step4Review form={form({ documentFileKey: 'uploads/brd.pdf' })} t={t} />)

      expect(screen.getByText('Dokumen terlampir')).toBeDefined()
    })
  })

  /**
   * The summary is a description list, so each label stays tied to its value
   * rather than reading as two unrelated runs of text.
   */
  it('pairs every label with its value in a description list', () => {
    const { container } = render(<Step4Review form={form()} t={t} />)

    expect(container.querySelectorAll('dl')).toHaveLength(3)
    expect(container.querySelectorAll('dt').length).toBe(container.querySelectorAll('dd').length)
  })

  it('falls back to the raw category when there is no translation for it', () => {
    render(<Step4Review form={form({ category: 'quantum_computing' })} t={t} />)

    expect(screen.getByText('quantum_computing')).toBeDefined()
  })
})

describe('ReviewItem', () => {
  it('pairs the label with its value', () => {
    const { container } = render(
      <dl>
        <ReviewItem label="Judul" value="Marketplace" />
      </dl>,
    )

    expect((container.querySelector('dt') as HTMLElement).textContent).toBe('Judul')
    expect((container.querySelector('dd') as HTMLElement).textContent).toBe('Marketplace')
  })

  /**
   * The description is the one field an owner types newlines into, so it is
   * laid out vertically and keeps its whitespace instead of collapsing to a
   * single run.
   */
  it('preserves the line breaks in a multiline value', () => {
    const { container } = render(
      <dl>
        <ReviewItem label="Deskripsi" value={'baris satu\nbaris dua'} multiline />
      </dl>,
    )

    expect((container.querySelector('dd') as HTMLElement).className).toContain(
      'whitespace-pre-wrap',
    )
    expect((container.querySelector('dl > div') as HTMLElement).className).toContain('flex-col')
  })

  it('lays a single-line value out beside its label', () => {
    const { container } = render(
      <dl>
        <ReviewItem label="Judul" value="Marketplace" />
      </dl>,
    )

    expect((container.querySelector('dl > div') as HTMLElement).className).toContain('items-start')
  })
})
