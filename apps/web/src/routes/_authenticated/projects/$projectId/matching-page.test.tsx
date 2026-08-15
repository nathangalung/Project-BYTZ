// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as matchingRoute from './matching'

/**
 * Where the owner picks who builds their project.
 *
 * Candidates are anonymous by design - the server strips the user id and the
 * internal scores before this page sees them - and one talent may hold only
 * one position on a team. Nothing had executed this file: it reported zero
 * statements, so it was outside the coverage denominator rather than counted
 * as uncovered.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = {
  id: 'p-1',
  title: 'Toko Online Batik',
  status: 'team_forming',
  teamSize: 2,
}

type RawPosition = {
  workPackageId: string
  title: string
  requiredSkills: string[]
  dependsOn?: string[]
  recommendations: { talentId: string; score: number; skillMatch: number; isExploration: boolean }[]
}

const PROFILES: Record<string, Record<string, unknown>> = {
  't-1': {
    id: 't-1',
    yearsOfExperience: 5,
    educationUniversity: 'ITB',
    educationMajor: 'Informatika',
    availabilityStatus: 'available',
    domainExpertise: ['fintech'],
    totalProjectsCompleted: 7,
  },
  't-2': {
    id: 't-2',
    yearsOfExperience: null,
    educationUniversity: null,
    educationMajor: null,
    availabilityStatus: 'available',
    domainExpertise: null,
    totalProjectsCompleted: 0,
  },
}

const SKILLS: Record<string, { skillName: string }[]> = {
  't-1': [{ skillName: 'Go' }, { skillName: 'PostgreSQL' }],
  't-2': [{ skillName: 'React' }],
}

const TWO_POSITIONS: RawPosition[] = [
  {
    workPackageId: 'wp-1',
    title: 'Backend API',
    requiredSkills: ['Go'],
    recommendations: [
      { talentId: 't-1', score: 0.87, skillMatch: 1, isExploration: false },
      { talentId: 't-2', score: 0.61, skillMatch: 0.5, isExploration: true },
    ],
  },
  {
    workPackageId: 'wp-2',
    title: 'Frontend',
    requiredSkills: ['React'],
    dependsOn: ['Backend API'],
    recommendations: [
      { talentId: 't-1', score: 0.55, skillMatch: 0.4, isExploration: false },
      { talentId: 't-2', score: 0.79, skillMatch: 0.9, isExploration: true },
    ],
  },
]

type Wiring = {
  positions?: RawPosition[]
  positionsStatus?: number
  /** Talents whose profile lookup fails, to exercise the enrichment drop. */
  missingProfiles?: string[]
}

/**
 * The positions feed and every talent lookup use raw fetch; only the project
 * and the confirm mutation go through apiFetch.
 */
function stubNetwork({
  positions = TWO_POSITIONS,
  positionsStatus = 200,
  missingProfiles = [],
}: Wiring = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/matching/') && url.includes('/positions')) {
      if (positionsStatus !== 200) return new Response('', { status: positionsStatus })
      return new Response(JSON.stringify({ success: true, data: { positions } }), { status: 200 })
    }
    const skillsMatch = url.match(/\/talents\/([^/]+)\/skills/)
    if (skillsMatch) {
      return new Response(JSON.stringify({ success: true, data: SKILLS[skillsMatch[1]] ?? [] }), {
        status: 200,
      })
    }
    const profileMatch = url.match(/\/talents\/([^/?]+)$/)
    if (profileMatch) {
      const id = profileMatch[1]
      if (missingProfiles.includes(id)) return new Response('', { status: 404 })
      return new Response(JSON.stringify({ success: true, data: PROFILES[id] }), { status: 200 })
    }
    return new Response('', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function render() {
  return renderRoute(matchingRoute, {
    path: '/projects/$projectId/matching',
    entry: '/projects/p-1/matching',
    destinations: ['/projects/$projectId'],
  })
}

/**
 * Scopes to one work package's section, since every candidate appears under
 * both positions. Async because the section only exists once the positions
 * feed and each talent lookup have resolved.
 */
async function position(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title })
  return within(heading.closest('section') as HTMLElement)
}

async function candidateCard(positionTitle: string, label: string) {
  const section = await position(positionTitle)
  const heading = section.getByRole('heading', { name: label })
  return heading.closest('div.rounded-xl') as HTMLElement
}

/**
 * The SLA banner on this page reads the status log through apiFetch and
 * iterates it, so a single blanket mock returning the project hands it a
 * non-iterable and takes the whole route into the error boundary.
 */
function stubApi(project: unknown = PROJECT) {
  apiFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/status-logs')) return { success: true, data: [] }
    return { success: true, data: project }
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  stubNetwork()
})

describe('loading the recommendations', () => {
  it('shows a spinner rather than an empty shortlist', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Talent Recommendations' })).toBeNull()
  })

  it('reports a failed load instead of claiming there are no candidates', async () => {
    stubNetwork({ positionsStatus: 500 })

    await render()

    expect(await screen.findByText('Could not load recommendations')).toBeDefined()
    expect(screen.queryByText('No talent recommendations yet.')).toBeNull()
  })

  it('says there are none yet when the search returned nothing', async () => {
    stubNetwork({ positions: [] })

    await render()

    expect(await screen.findByText('No talent recommendations yet.')).toBeDefined()
  })

  it('names each position and the skills it needs', async () => {
    await render()

    expect(await screen.findByRole('heading', { name: 'Backend API' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Frontend' })).toBeDefined()
    expect(screen.getByText('Position 1')).toBeDefined()
    expect(screen.getByText('Position 2')).toBeDefined()

    // Scoped to the requirement row: candidate cards below list skills too.
    const backend = await position('Backend API')
    const needed = backend.getByText('Skills needed:').parentElement as HTMLElement
    expect(within(needed).getByText('Go')).toBeDefined()
    const frontend = await position('Frontend')
    const neededThere = frontend.getByText('Skills needed:').parentElement as HTMLElement
    expect(within(neededThere).getByText('React')).toBeDefined()
  })

  /** Staff the blocker before the work that waits on it. */
  it('shows which position a dependent one waits on', async () => {
    await render()

    const frontend = await position('Frontend')
    expect(frontend.getByText('Waits on:')).toBeDefined()
    expect(frontend.getByText('Backend API')).toBeDefined()
  })

  it('says a position has no candidates rather than leaving it blank', async () => {
    stubNetwork({
      positions: [
        { workPackageId: 'wp-1', title: 'Backend API', requiredSkills: [], recommendations: [] },
      ],
    })

    await render()

    expect(await screen.findByText('No candidates for this position yet')).toBeDefined()
  })
})

/** The owner judges competence, never identity. */
describe('what an owner is shown about a candidate', () => {
  it('identifies candidates by number, never by name or id', async () => {
    await render()

    const backend = await position('Backend API')
    expect(backend.getByRole('heading', { name: 'Talent #1' })).toBeDefined()
    expect(backend.getByRole('heading', { name: 'Talent #2' })).toBeDefined()
    expect(screen.queryByText(/t-1|t-2/)).toBeNull()
  })

  it('shows the match score, education, experience and skills', async () => {
    await render()

    // Scoped to the one card: the requirement row above lists skills too.
    const card = within(await candidateCard('Backend API', 'Talent #1'))
    expect(card.getByText('87%')).toBeDefined()
    expect(card.getByText('Informatika — ITB')).toBeDefined()
    expect(card.getByText('5 years')).toBeDefined()
    expect(card.getByText('Go')).toBeDefined()
    expect(card.getByText('PostgreSQL')).toBeDefined()
    expect(card.getByText('fintech')).toBeDefined()
  })

  /** New talent get exploration slots; the badge says why they are listed. */
  it('marks an exploration candidate as new talent', async () => {
    await render()

    expect(
      within(await candidateCard('Backend API', 'Talent #2')).getByText('New Talent'),
    ).toBeDefined()
    expect(
      within(await candidateCard('Backend API', 'Talent #1')).queryByText('New Talent'),
    ).toBeNull()
  })

  it('shows a dash where a candidate has no education or experience on file', async () => {
    await render()

    const card = await candidateCard('Backend API', 'Talent #2')
    expect(within(card).getAllByText('-').length).toBeGreaterThan(0)
  })

  /**
   * enrichTalents drops any recommendation whose profile lookup failed, so the
   * candidate silently disappears from the shortlist rather than the owner
   * being told the profile could not be loaded. Recorded as the current
   * behaviour; it is a finding.
   */
  it('drops a candidate whose profile could not be loaded, without saying so', async () => {
    stubNetwork({ missingProfiles: ['t-1'] })

    await render()

    const backend = await position('Backend API')
    expect(backend.getByRole('heading', { name: 'Talent #2' })).toBeDefined()
    expect(backend.queryByRole('heading', { name: 'Talent #1' })).toBeNull()
    expect(backend.queryByText('No candidates for this position yet')).toBeNull()
  })
})

describe('picking a team', () => {
  it('counts positions as they are filled', async () => {
    const user = userEvent.setup()
    await render()
    expect(await screen.findByText('0 of 2 positions filled')).toBeDefined()

    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Select',
      }),
    )

    expect(await screen.findByText('1 of 2 positions filled')).toBeDefined()
  })

  it('marks the chosen candidate as selected', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Select',
      }),
    )

    const card = await candidateCard('Backend API', 'Talent #1')
    expect(within(card).getByText('Selected')).toBeDefined()
    expect(within(card).getByRole('button', { name: 'Change' })).toBeDefined()
  })

  it('lets the owner undo a choice by picking the same candidate again', async () => {
    const user = userEvent.setup()
    await render()
    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Select',
      }),
    )

    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Change',
      }),
    )

    expect(await screen.findByText('0 of 2 positions filled')).toBeDefined()
  })

  /** One talent cannot hold two positions on the same team. */
  it('blocks a candidate already chosen for another position', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Select',
      }),
    )

    const elsewhere = within(await candidateCard('Frontend', 'Talent #1')).getByRole('button', {
      name: 'Chosen for another position',
    })
    expect(elsewhere.hasAttribute('disabled')).toBe(true)
  })

  it('withholds the confirm control until every position is filled', async () => {
    const user = userEvent.setup()
    await render()
    expect(screen.queryByRole('button', { name: /Confirm Selection/ })).toBeNull()

    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Select',
      }),
    )
    expect(screen.queryByRole('button', { name: /Confirm Selection/ })).toBeNull()

    await user.click(
      within(await candidateCard('Frontend', 'Talent #2')).getByRole('button', {
        name: 'Select',
      }),
    )

    expect(await screen.findByRole('button', { name: /Confirm Selection/ })).toBeDefined()
    expect(screen.getByText('All positions filled!')).toBeDefined()
  })

  it('offers no confirm control when there are no positions at all', async () => {
    stubNetwork({ positions: [] })

    await render()

    expect(await screen.findByText('0 of 0 positions filled')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Confirm Selection/ })).toBeNull()
  })
})

describe('confirming the team', () => {
  async function fillBothPositions() {
    const user = userEvent.setup()
    const rendered = await render()
    await user.click(
      within(await candidateCard('Backend API', 'Talent #1')).getByRole('button', {
        name: 'Select',
      }),
    )
    await user.click(
      within(await candidateCard('Frontend', 'Talent #2')).getByRole('button', {
        name: 'Select',
      }),
    )
    await screen.findByRole('button', { name: /Confirm Selection/ })
    return { user, ...rendered }
  }

  it('sends each talent with the work package they were picked for', async () => {
    const { user } = await fillBothPositions()

    await user.click(screen.getByRole('button', { name: /Confirm Selection/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/matching/confirm',
        expect.objectContaining({
          body: JSON.stringify({
            projectId: 'p-1',
            assignments: [
              { workPackageId: 'wp-1', talentId: 't-1' },
              { workPackageId: 'wp-2', talentId: 't-2' },
            ],
          }),
        }),
      ),
    )
  })

  it('returns the owner to the project once the offers are out', async () => {
    const { user, router } = await fillBothPositions()

    await user.click(screen.getByRole('button', { name: /Confirm Selection/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1'))
  })
})
