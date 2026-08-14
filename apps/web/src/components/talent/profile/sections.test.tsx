// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import {
  EducationSection,
  PortfolioSection,
  ProfileSkeleton,
  RatingHistorySection,
  SkillsSection,
} from './sections'
import type { TalentProfile } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const t = i18n.getFixedT('id', 'talent')

function profile(overrides: Partial<TalentProfile> = {}): TalentProfile {
  return {
    id: 'tp-1',
    userId: 'u-1',
    bio: 'Fullstack developer',
    yearsOfExperience: 4,
    tier: 'mid',
    educationUniversity: null,
    educationMajor: null,
    educationYear: null,
    cvFileUrl: null,
    portfolioLinks: [],
    availabilityStatus: 'available',
    verificationStatus: 'verified',
    domainExpertise: [],
    totalProjectsCompleted: 3,
    totalProjectsActive: 1,
    averageRating: 4.5,
    skills: [],
    ...overrides,
  }
}

function skill(overrides: Partial<TalentProfile['skills'][number]> = {}) {
  return {
    name: 'React',
    category: 'frontend',
    proficiencyLevel: 'advanced',
    isPrimary: false,
    ...overrides,
  }
}

describe('SkillsSection', () => {
  it('says so when the talent has listed none', () => {
    render(<SkillsSection profile={profile()} t={t} />)

    expect(screen.getByText('Belum ada keahlian ditambahkan')).toBeDefined()
  })

  it('lists the skills the talent holds', () => {
    render(<SkillsSection profile={profile({ skills: [skill(), skill({ name: 'Go' })] })} t={t} />)

    expect(screen.getByText('React')).toBeDefined()
    expect(screen.getByText('Go')).toBeDefined()
  })

  /**
   * Miller's law: skills are chunked by category rather than listed flat, so
   * a talent with twenty of them reads as five groups instead of one wall.
   */
  it('groups the skills by category', () => {
    render(
      <SkillsSection
        profile={profile({
          skills: [skill({ name: 'React' }), skill({ name: 'Go', category: 'backend' })],
        })}
        t={t}
      />,
    )

    expect(screen.getByText('Frontend')).toBeDefined()
    expect(screen.getByText('Backend')).toBeDefined()
  })

  /**
   * The order is the taxonomy's, not the order rows happened to arrive in, so
   * two talents with the same skills read the same way.
   */
  it('orders the categories by the taxonomy rather than by arrival', () => {
    const { container } = render(
      <SkillsSection
        profile={profile({
          skills: [
            skill({ name: 'Figma', category: 'design' }),
            skill({ name: 'Go', category: 'backend' }),
            skill({ name: 'React', category: 'frontend' }),
          ],
        })}
        t={t}
      />,
    )

    const headings = Array.from(container.querySelectorAll('.uppercase')).map(
      (el) => el.textContent,
    )
    expect(headings).toEqual(['Frontend', 'Backend', 'Desain'])
  })

  it('files a skill with no category under other', () => {
    render(<SkillsSection profile={profile({ skills: [skill({ category: '' })] })} t={t} />)

    expect(screen.getByText('React')).toBeDefined()
  })

  /**
   * A primary skill is what the talent leads with, so it is marked with a star
   * as well as a colour - colour alone cannot carry the distinction.
   */
  it('marks a primary skill with a star as well as a colour', () => {
    const { container } = render(
      <SkillsSection profile={profile({ skills: [skill({ isPrimary: true })] })} t={t} />,
    )

    expect(container.querySelectorAll('svg')).toHaveLength(2)
    const tag = Array.from(container.querySelectorAll('span')).find((el) =>
      el.textContent?.startsWith('React'),
    )
    expect(tag?.className).toContain('border-success-500')
  })

  it('leaves a secondary skill unstarred', () => {
    const { container } = render(
      <SkillsSection profile={profile({ skills: [skill({ isPrimary: false })] })} t={t} />,
    )

    // Only the section header icon.
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('shows the proficiency beside each skill', () => {
    render(<SkillsSection profile={profile({ skills: [skill()] })} t={t} />)

    expect(screen.getByText('Mahir')).toBeDefined()
  })

  it('falls back for a proficiency it does not recognise', () => {
    render(
      <SkillsSection profile={profile({ skills: [skill({ proficiencyLevel: 'guru' })] })} t={t} />,
    )

    expect(screen.getByText('guru')).toBeDefined()
  })
})

describe('PortfolioSection', () => {
  it('says so when there are no links', () => {
    render(<PortfolioSection profile={profile()} t={t} />)

    expect(screen.getByText('Belum ada tautan portofolio')).toBeDefined()
  })

  /**
   * Portfolio links leave the platform, so they open in a new tab and must not
   * hand the opener over.
   */
  it('opens each link safely in a new tab', () => {
    render(
      <PortfolioSection
        profile={profile({
          portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/talenta' }],
        })}
        t={t}
      />,
    )

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://github.com/talenta')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('names the platform and shows the address', () => {
    render(
      <PortfolioSection
        profile={profile({
          portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/talenta' }],
        })}
        t={t}
      />,
    )

    expect(screen.getByText('GitHub')).toBeDefined()
    expect(screen.getByText('https://github.com/talenta')).toBeDefined()
  })

  it('falls back to a generic icon for a platform it has none for', () => {
    render(
      <PortfolioSection
        profile={profile({ portfolioLinks: [{ platform: 'Gitea', url: 'https://gitea.io/t' }] })}
        t={t}
      />,
    )

    expect(screen.getByRole('link')).toBeDefined()
  })

  it('lists every link rather than only the first', () => {
    render(
      <PortfolioSection
        profile={profile({
          portfolioLinks: [
            { platform: 'GitHub', url: 'https://github.com/t' },
            { platform: 'Dribbble', url: 'https://dribbble.com/t' },
          ],
        })}
        t={t}
      />,
    )

    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})

describe('EducationSection', () => {
  /**
   * An empty education card would be a heading over nothing, so the section is
   * dropped entirely when the talent gave no education at all.
   */
  it('renders nothing when there is no education to show', () => {
    const { container } = render(<EducationSection profile={profile()} t={t} />)

    expect(container.firstChild).toBeNull()
  })

  it('shows the university, the major and the year', () => {
    render(
      <EducationSection
        profile={profile({
          educationUniversity: 'Institut Teknologi Bandung',
          educationMajor: 'Teknik Informatika',
          educationYear: 2022,
        })}
        t={t}
      />,
    )

    expect(screen.getByText('Institut Teknologi Bandung')).toBeDefined()
    expect(screen.getByText('Teknik Informatika')).toBeDefined()
    expect(screen.getByText(/2022/)).toBeDefined()
  })

  it.each([
    ['educationUniversity', 'Institut Teknologi Bandung'],
    ['educationMajor', 'Teknik Informatika'],
    ['educationYear', 2022],
  ])('renders the card on %s alone', (field, value) => {
    render(<EducationSection profile={profile({ [field]: value })} t={t} />)

    expect(screen.getByRole('heading', { name: 'Pendidikan' })).toBeDefined()
  })

  it('omits the rows that were not filled in', () => {
    render(<EducationSection profile={profile({ educationUniversity: 'ITB' })} t={t} />)

    expect(screen.getByText('ITB')).toBeDefined()
    expect(screen.queryByText(/Lulus/)).toBeNull()
  })
})

describe('RatingHistorySection', () => {
  function stubRatings(ratings: unknown[] | 'pending' | 'error') {
    if (ratings === 'pending') {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      )
      return
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          ratings === 'error'
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify({ data: ratings }), {
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
        <RatingHistorySection t={t} />
      </QueryClientProvider>,
    )
  }

  /**
   * Ratings are internal: the talent sees their own for self-improvement and
   * nobody else does. The header has to say so, or a talent reasonably assumes
   * owners are reading them.
   */
  it('says the ratings are internal only', () => {
    stubRatings([])
    renderSection()

    expect(screen.getByText('(Hanya terlihat oleh Anda)')).toBeDefined()
  })

  it('shows placeholders while the ratings load', () => {
    stubRatings('pending')
    const { container } = renderSection()

    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Belum ada penilaian')).toBeNull()
  })

  it('says so when there are none yet', async () => {
    stubRatings([])
    renderSection()

    expect(await screen.findByText('Belum ada penilaian')).toBeDefined()
  })

  it('falls back to the empty message when the request fails', async () => {
    stubRatings('error')
    renderSection()

    expect(await screen.findByText('Belum ada penilaian')).toBeDefined()
  })

  it('shows each review with its date and comment', async () => {
    stubRatings([
      {
        id: 'r-1',
        projectId: 'p-1',
        rating: 4,
        comment: 'Tepat waktu',
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ])
    renderSection()

    expect(await screen.findByText('Tepat waktu')).toBeDefined()
    expect(screen.getByText('13 Agu 2026')).toBeDefined()
  })

  /**
   * Four filled stars out of five. Filling all of them, or none, would show
   * the talent a score they were not given.
   */
  it('fills the stars to the score', async () => {
    stubRatings([
      {
        id: 'r-1',
        projectId: 'p-1',
        rating: 4,
        comment: '',
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ])
    const { container } = renderSection()

    await screen.findByText('13 Agu 2026')
    expect(container.querySelectorAll('.fill-warning-500')).toHaveLength(4)
  })

  it('renders a review left without a comment', async () => {
    stubRatings([
      {
        id: 'r-1',
        projectId: 'p-1',
        rating: 5,
        comment: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ])
    renderSection()

    expect(await screen.findByText('13 Agu 2026')).toBeDefined()
  })
})

describe('ProfileSkeleton', () => {
  /**
   * The loading state mirrors the shape of the profile so the layout does not
   * jump when the data lands, and every placeholder stays out of the
   * accessibility tree.
   */
  it('renders placeholders that no screen reader will announce', () => {
    const { container } = render(<ProfileSkeleton />)

    const placeholders = container.querySelectorAll('.animate-pulse')
    expect(placeholders.length).toBeGreaterThan(0)
    for (const placeholder of placeholders) {
      expect(placeholder.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('shows no text, so nothing reads as content while loading', () => {
    const { container } = render(<ProfileSkeleton />)

    expect(container.textContent).toBe('')
  })
})
