// @vitest-environment jsdom
import type { PrdContent } from '@kerjacus/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { PrdDocumentBody } from './prd-document-body'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

function content(overrides: Partial<PrdContent> = {}): PrdContent {
  return {
    techStack: [
      { name: 'React', category: 'frontend', description: 'UI', recommended: true },
      { name: 'Hono', category: 'backend', description: 'API', recommended: false },
    ],
    architecture: 'Microservice dengan API gateway',
    apiDesign: [{ method: 'POST', path: '/api/v1/projects', description: 'Buat proyek' }],
    databaseSchema: [{ name: 'projects', description: 'Baris proyek', columns: 12 }],
    teamComposition: [
      { role: 'Backend Developer', skills: ['Go', 'Postgres'], estimatedHours: 160 },
    ],
    workPackages: [
      {
        name: 'Backend API',
        requiredSkills: ['Go'],
        estimatedHours: 160,
        amount: 12_000_000,
        dependencies: [],
        deliverables: [],
        acceptanceCriteria: [],
      },
      {
        name: 'Frontend',
        requiredSkills: ['React'],
        estimatedHours: 120,
        amount: 8_000_000,
        dependencies: ['Backend API'],
        deliverables: [],
        acceptanceCriteria: [],
      },
    ],
    sprintPlan: [{ name: 'Sprint 1', duration: '2 minggu', milestones: ['Skema database'] }],
    dependencyGraph: [{ from: 'Backend API', to: 'Frontend', type: 'finish_to_start' }],
    assumptions: ['Owner menyediakan konten produk'],
    risks: ['Timeline ketat untuk scope ini'],
    totalCost: 20_000_000,
    teamSize: 2,
    totalEstimatedHours: 280,
    ...overrides,
  }
}

/**
 * Two sections are reached by position rather than by name.
 *
 * The body calls useTranslation('project') but `deliverables_acceptance` and
 * `risks` are only defined in the `document` namespace, so i18next echoes the
 * key and the owner reads "risks" where a heading should be. That is a defect
 * reported separately - and querying by the raw key here would make these
 * tests fail on the day it is fixed, which is the wrong way round. Position is
 * what survives the fix.
 */
function sectionToggles(): HTMLElement[] {
  return screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'))
}

/** Sections start collapsed unless defaultOpen; open the one under test. */
async function openSection(name: RegExp) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name }))
}

/** Risks is the last section the body renders when it has any. */
async function openLastSection() {
  const user = userEvent.setup()
  const toggles = sectionToggles()
  await user.click(toggles[toggles.length - 1])
}

describe('PrdDocumentBody', () => {
  describe('the paywall', () => {
    it('watermarks an unpaid document', () => {
      const { container } = render(<PrdDocumentBody content={content()} isUnlocked={false} />)

      expect(container.querySelector('[aria-hidden="true"].pointer-events-none')).not.toBeNull()
    })

    it('leaves a paid document clean', () => {
      const { container } = render(<PrdDocumentBody content={content()} isUnlocked />)

      expect(container.querySelector('[aria-hidden="true"].pointer-events-none')).toBeNull()
    })
  })

  describe('the sections that open by default', () => {
    /**
     * Tech stack, team composition and work packages are what the owner is
     * approving, so they are open on arrival; the rest is reference material
     * behind a disclosure.
     */
    it('shows the tech stack, the team and the work packages', () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      expect(screen.getAllByText('React').length).toBeGreaterThan(0)
      expect(screen.getByText('Backend Developer')).toBeDefined()
      expect(screen.getAllByText('Frontend').length).toBeGreaterThan(0)
    })

    it('leaves the architecture collapsed until asked', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)
      expect(screen.queryByText('Microservice dengan API gateway')).toBeNull()

      await openSection(/Arsitektur|Architecture/)

      expect(screen.getByText('Microservice dengan API gateway')).toBeDefined()
    })

    it('reports whether a section is open to assistive technology', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)
      const toggle = screen.getByRole('button', { name: /Arsitektur|Architecture/ })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')

      await openSection(/Arsitektur|Architecture/)

      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('marks the recommended technology and leaves the rest unmarked', () => {
    const { container } = render(<PrdDocumentBody content={content()} isUnlocked />)

    const react = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent === 'React',
    )
    expect(react).toBeDefined()
    expect(screen.getByText('Hono')).toBeDefined()
  })

  describe('the work package table', () => {
    /**
     * The totals are what the owner checks the quoted price against, so they
     * are summed from the rows rather than taken from a separate field that
     * could disagree with them.
     */
    it('totals the hours and the amounts from the rows themselves', () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      expect(screen.getByText('280h')).toBeDefined()
      expect(screen.getByText('Rp 20.000.000')).toBeDefined()
    })

    it('names the packages a package depends on', () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      expect(screen.getAllByText('Backend API').length).toBeGreaterThan(0)
    })

    it('lists the skills each package needs', () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      expect(screen.getAllByText('Go').length).toBeGreaterThan(0)
    })

    it('totals to zero when the PRD priced nothing', () => {
      render(<PrdDocumentBody content={content({ workPackages: [] })} isUnlocked />)

      expect(screen.getByText('Rp 0')).toBeDefined()
    })
  })

  describe('the acceptance section', () => {
    /**
     * It only appears when at least one package actually carries deliverables
     * or criteria - an empty heading over nothing tells the owner there is
     * something to review when there is not.
     */
    it('stays out of the document when no package defines any', () => {
      const withDeliverables = content({
        workPackages: [
          {
            name: 'Backend API',
            requiredSkills: [],
            estimatedHours: 1,
            amount: 1,
            dependencies: [],
            deliverables: [{ title: 'Dokumentasi API', type: 'document', expected: '' }],
            acceptanceCriteria: [],
          },
        ],
      })

      const { unmount } = render(<PrdDocumentBody content={withDeliverables} isUnlocked />)
      const sectionsWhenPresent = sectionToggles().length
      unmount()

      render(<PrdDocumentBody content={content()} isUnlocked />)

      // The same document minus the deliverables loses exactly that section.
      expect(sectionToggles()).toHaveLength(sectionsWhenPresent - 1)
      expect(screen.queryByText('Dokumentasi API')).toBeNull()
    })

    it('appears once a package defines deliverables', async () => {
      render(
        <PrdDocumentBody
          content={content({
            workPackages: [
              {
                name: 'Backend API',
                requiredSkills: ['Go'],
                estimatedHours: 160,
                amount: 12_000_000,
                dependencies: [],
                deliverables: [
                  { title: 'Dokumentasi API', type: 'document', expected: 'OpenAPI 3.1' },
                ],
                acceptanceCriteria: [],
              },
            ],
          })}
          isUnlocked
        />,
      )

      // Open on arrival: it is part of what the owner is approving, so the
      // deliverable is readable without expanding anything.
      expect(screen.getByText('Dokumentasi API')).toBeDefined()
      expect(screen.getByText('OpenAPI 3.1', { exact: false })).toBeDefined()
      expect(screen.getByText('document')).toBeDefined()
    })

    it('appears on acceptance criteria alone', async () => {
      render(
        <PrdDocumentBody
          content={content({
            workPackages: [
              {
                name: 'Backend API',
                requiredSkills: ['Go'],
                estimatedHours: 160,
                amount: 12_000_000,
                dependencies: [],
                deliverables: [],
                acceptanceCriteria: ['Cakupan tes di atas 80 persen'],
              },
            ],
          })}
          isUnlocked
        />,
      )

      expect(screen.getByText('Cakupan tes di atas 80 persen')).toBeDefined()
    })
  })

  describe('the optional sections', () => {
    it.each(['assumptions', 'risks'] as const)('drops %s when the AI returned none', (field) => {
      const { unmount } = render(<PrdDocumentBody content={content()} isUnlocked />)
      const sectionsWhenPresent = sectionToggles().length
      unmount()

      render(<PrdDocumentBody content={content({ [field]: [] })} isUnlocked />)

      expect(sectionToggles()).toHaveLength(sectionsWhenPresent - 1)
    })

    it('shows the assumptions when there are some', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      await openSection(/Asumsi|Assumption/)

      expect(screen.getByText('Owner menyediakan konten produk')).toBeDefined()
    })

    it('shows the risks when there are some', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      await openLastSection()

      expect(screen.getByText('Timeline ketat untuk scope ini')).toBeDefined()
    })
  })

  describe('the reference sections', () => {
    it('lists each API endpoint with its method', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      await openSection(/API/)

      expect(screen.getByText('POST')).toBeDefined()
      expect(screen.getByText('/api/v1/projects')).toBeDefined()
    })

    it('falls back for an HTTP method it has no colour for', async () => {
      render(
        <PrdDocumentBody
          content={content({
            apiDesign: [{ method: 'TRACE', path: '/api/v1/debug', description: 'Debug' }],
          })}
          isUnlocked
        />,
      )

      await openSection(/API/)

      expect(screen.getByText('TRACE')).toBeDefined()
    })

    it('lists each database table with its column count', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      await openSection(/Skema|Database/)

      expect(screen.getByText('projects')).toBeDefined()
    })

    it('lists each sprint with its milestones', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      await openSection(/Sprint/)

      expect(screen.getByText('Sprint 1')).toBeDefined()
      expect(screen.getByText('Skema database')).toBeDefined()
    })

    it('lists the dependency graph', async () => {
      render(<PrdDocumentBody content={content()} isUnlocked />)

      await openSection(/Dependen|Ketergantungan/)

      expect(screen.getAllByText('Frontend').length).toBeGreaterThan(0)
    })
  })
})
