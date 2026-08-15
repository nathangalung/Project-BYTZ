// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as milestonesRoute from './milestones'

/**
 * The only screen from which a milestone can be submitted or approved.
 *
 * Approving is what releases escrow, so the buttons here are the entry to
 * money leaving the platform, and which of them a viewer is offered is decided
 * entirely by `role`. Nothing had ever executed this file: it reported zero
 * statements, meaning it sat outside the coverage denominator rather than
 * counted as uncovered.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})
vi.mock('@/lib/centrifugo', () => ({
  connectCentrifugo: vi.fn(),
  disconnectCentrifugo: vi.fn(),
  subscribeTo: vi.fn(() => vi.fn()),
}))
// SVAR Gantt drags a stylesheet and a canvas measurement pass through jsdom;
// the branch under test is which tab renders, not what the chart draws.
vi.mock('@/components/project/gantt-view', () => ({
  GanttView: ({ projectId }: { projectId: string }) => <div>gantt for {projectId}</div>,
}))

const PROJECT = { id: 'p-1', title: 'Toko Online Batik', status: 'in_progress', teamSize: 2 }

type Milestone = Record<string, unknown>

const SUBMITTED: Milestone = {
  id: 'm-1',
  title: 'Autentikasi',
  description: 'Login dan daftar',
  status: 'submitted',
  amount: 4_000_000,
  dueDate: '2099-01-01T00:00:00.000Z',
  revisionCount: 0,
  assignedWorkerLabel: 'Talent #1',
  milestoneType: 'individual',
  orderIndex: 0,
}

const PENDING: Milestone = {
  ...SUBMITTED,
  id: 'm-2',
  title: 'Katalog Produk',
  status: 'pending',
  amount: 2_500_000,
  orderIndex: 1,
}

/**
 * Routes both network boundaries this page reaches.
 *
 * The board itself goes through apiFetch, but the slide-over's attachment and
 * comment queries use raw fetch - mocking only apiFetch leaves those hitting
 * jsdom's real fetch and failing as unhandled rejections rather than as tests.
 */
function stubApi(milestones: Milestone[] = [SUBMITTED, PENDING], project: unknown = PROJECT) {
  apiFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/milestones')) return { success: true, data: milestones }
    return { success: true, data: project }
  })
}

const OWNER = { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' }
const TALENT = { ...OWNER, id: 'u2', name: 'Ari', role: 'talent' }

function signIn(user: Record<string, unknown> = OWNER) {
  useAuthStore.setState({
    user: user as never,
    isAuthenticated: true,
    isLoading: false,
  })
}

function render() {
  return renderRoute(milestonesRoute, {
    path: '/projects/$projectId/milestones',
    entry: '/projects/p-1/milestones',
    destinations: ['/projects/$projectId', '/projects/$projectId/checkout'],
  })
}

/**
 * Opens the slide-over, where every approve and submit control lives.
 *
 * Scoped to the panel rather than the document: the card behind it repeats the
 * title, the amount and the talent label, so an unscoped query would pass on
 * the card's copy while the panel rendered nothing.
 */
async function openDetail(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(title, 'i') }))
  const heading = await screen.findByRole('heading', { level: 2, name: title })
  return within(heading.closest('div.fixed') as HTMLElement)
}

function toastMessages() {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  useToastStore.setState({ toasts: [] })
  signIn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  )
})

describe('loading the board', () => {
  it('shows a spinner rather than an empty board while the milestones arrive', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Milestone Board' })).toBeNull()
  })

  it('totals what the project is worth across every milestone', async () => {
    await render()

    expect(await screen.findByText('Rp 6.500.000')).toBeDefined()
  })

  it('counts the milestones it loaded', async () => {
    await render()

    expect(await screen.findByText('2 milestones')).toBeDefined()
  })

  it('files each milestone under its own status column', async () => {
    await render()

    const submittedColumn = (await screen.findByRole('heading', { name: 'Submitted' }))
      .parentElement
    const pendingColumn = screen.getByRole('heading', { name: 'Pending' }).parentElement
    expect(within(submittedColumn as HTMLElement).getByText('1')).toBeDefined()
    expect(within(pendingColumn as HTMLElement).getByText('1')).toBeDefined()
  })

  /** A status the board has no column for must not vanish from the board. */
  it('files an unrecognised status under Pending rather than dropping it', async () => {
    stubApi([{ ...SUBMITTED, status: 'awaiting_alien_approval' }])

    await render()

    const column = (await screen.findByRole('heading', { name: 'Pending' })).parentElement
    expect(within(column as HTMLElement).getByText('1')).toBeDefined()
    expect(screen.getByRole('button', { name: /Autentikasi/ })).toBeDefined()
  })

  it('says a column is empty instead of leaving a blank space', async () => {
    stubApi([])

    await render()

    expect((await screen.findAllByText('No milestones for this project yet.')).length).toBe(6)
  })

  /**
   * Every optional field the service may omit is read through a fallback. A
   * milestone carrying only its identity has to render as a card rather than
   * take the board down, because one absent dueDate would otherwise cost the
   * owner sight of every other milestone too.
   */
  it('renders a milestone that carries only an id, a title and a status', async () => {
    stubApi([{ id: 'm-bare', title: 'Tanpa Detail', status: 'pending' }])

    await render()

    expect(await screen.findByRole('button', { name: /Tanpa Detail/ })).toBeDefined()
    // Absent amount reads as zero on the card and in the board total alike.
    expect(screen.getAllByText('Rp 0').length).toBe(2)
    expect(screen.getByText('1 milestones')).toBeDefined()
  })
})

/**
 * Which control a viewer is offered is the authorization boundary. An owner
 * approving is the escrow release; a talent must never be able to fire it.
 */
describe('the controls each role is offered on a submitted milestone', () => {
  it('offers an owner approve, request revision and reject', async () => {
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByRole('button', { name: 'Approve' })).toBeDefined()
    expect(panel.getByRole('button', { name: 'Request Revision' })).toBeDefined()
    expect(panel.getByRole('button', { name: 'Reject' })).toBeDefined()
  })

  it('withholds approve from a talent', async () => {
    signIn(TALENT)
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(panel.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(panel.queryByRole('button', { name: 'Request Revision' })).toBeNull()
  })

  it('offers a talent the start control on a pending milestone', async () => {
    signIn(TALENT)
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Katalog Produk')

    expect(panel.getByRole('button', { name: 'Start' })).toBeDefined()
  })

  it('withholds the start control from an owner', async () => {
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Katalog Produk')

    expect(panel.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('offers a talent the submit control once work is in progress', async () => {
    stubApi([{ ...SUBMITTED, status: 'in_progress' }])
    signIn(TALENT)
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByRole('button', { name: 'Submit Project' })).toBeDefined()
  })

  it('offers a talent the way back into work after a revision request', async () => {
    stubApi([{ ...SUBMITTED, status: 'revision_requested' }])
    signIn(TALENT)
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByRole('button', { name: 'Resume' })).toBeDefined()
  })
})

/**
 * The board card carries its own quick actions, so a talent can move work
 * along without opening anything. This is the path that does not touch
 * selectedMilestone at all.
 */
describe('the quick actions on a board card', () => {
  it('lets a talent start pending work straight from the board', async () => {
    signIn(TALENT)
    const user = userEvent.setup()
    await render()

    const card = (await screen.findByRole('button', { name: /Katalog Produk/ }))
      .parentElement as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'In Progress' }))

    await waitFor(() => expect(toastMessages()).toContain('Milestone status updated'))
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/milestones/m-2/status',
      expect.objectContaining({
        body: JSON.stringify({ status: 'in_progress', reason: undefined }),
      }),
    )
  })

  it('gives an owner no quick action on the same card', async () => {
    await render()

    const card = (await screen.findByRole('button', { name: /Katalog Produk/ }))
      .parentElement as HTMLElement

    expect(within(card).queryByRole('button', { name: 'In Progress' })).toBeNull()
  })
})

describe('approving a milestone', () => {
  it('sends the approval and confirms it', async () => {
    const user = userEvent.setup()
    await render()
    const panel = await openDetail(user, 'Autentikasi')

    await user.click(panel.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(toastMessages()).toContain('Milestone approved'))
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/milestones/m-1/status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved', reason: undefined }),
      }),
    )
  })

  it('reports the reason when the approval is refused', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/status')) throw new Error('escrow is frozen')
      if (String(url).includes('/milestones')) return { success: true, data: [SUBMITTED, PENDING] }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    await render()
    const panel = await openDetail(user, 'Autentikasi')

    await user.click(panel.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(toastMessages()).toContain('escrow is frozen'))
  })
})

describe('requesting a revision', () => {
  it('confirms the request when it is within the free allowance', async () => {
    const user = userEvent.setup()
    await render()
    const panel = await openDetail(user, 'Autentikasi')

    await user.click(panel.getByRole('button', { name: 'Request Revision' }))

    await waitFor(() => expect(toastMessages()).toContain('Revision request sent successfully'))
  })

  /**
   * Past the two free revisions the service answers MILESTONE_REVISION_LIMIT.
   * A toast alone would be a dead end, so the owner is carried to the checkout
   * that charges for the extra round - with the milestone it applies to.
   */
  it('carries the owner to the revision checkout once the free rounds are used', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/status')) {
        throw new ApiError('limit reached', 402, 'MILESTONE_REVISION_LIMIT')
      }
      if (String(url).includes('/milestones')) return { success: true, data: [SUBMITTED, PENDING] }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    const { router } = await render()
    const panel = await openDetail(user, 'Autentikasi')

    await user.click(panel.getByRole('button', { name: 'Request Revision' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/checkout'))
    expect(router.state.location.search).toEqual({ type: 'revision', milestoneId: 'm-1' })
    expect(toastMessages()).toContain(
      'The two free revisions are used up. Pay the revision fee to continue.',
    )
  })

  /** A different failure code is an error, not an invitation to pay. */
  it('reports any other failure without sending the owner to checkout', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/status')) {
        throw new ApiError('not yours', 403, 'PROJECT_FORBIDDEN')
      }
      if (String(url).includes('/milestones')) return { success: true, data: [SUBMITTED, PENDING] }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    const { router } = await render()
    const panel = await openDetail(user, 'Autentikasi')

    await user.click(panel.getByRole('button', { name: 'Request Revision' }))

    await waitFor(() => expect(toastMessages()).toContain('not yours'))
    expect(router.state.location.pathname).toBe('/projects/p-1/milestones')
  })
})

/** Rejection is the one status change that asks for a reason first. */
describe('rejecting a milestone', () => {
  async function openRejectDialog() {
    const user = userEvent.setup()
    await render()
    const panel = await openDetail(user, 'Autentikasi')
    await user.click(panel.getByRole('button', { name: 'Reject' }))
    const heading = await screen.findByRole('heading', { name: 'Reject Milestone' })
    return { user, dialog: within(heading.closest('div.fixed') as HTMLElement) }
  }

  it('asks for a reason before rejecting anything', async () => {
    const { dialog } = await openRejectDialog()

    expect(dialog.getByPlaceholderText('Explain the rejection reason...')).toBeDefined()
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/milestones/m-1/status', expect.anything())
  })

  it('sends the typed reason with the rejection', async () => {
    const { user, dialog } = await openRejectDialog()

    await user.type(
      dialog.getByPlaceholderText('Explain the rejection reason...'),
      'Login masih gagal',
    )
    await user.click(dialog.getByRole('button', { name: 'Reject' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/milestones/m-1/status',
        expect.objectContaining({
          body: JSON.stringify({ status: 'rejected', reason: 'Login masih gagal' }),
        }),
      ),
    )
    expect(toastMessages()).toContain('Milestone rejected')
  })

  it('omits an empty reason rather than sending a blank string', async () => {
    const { user, dialog } = await openRejectDialog()

    await user.click(dialog.getByRole('button', { name: 'Reject' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/milestones/m-1/status',
        expect.objectContaining({
          body: JSON.stringify({ status: 'rejected', reason: undefined }),
        }),
      ),
    )
  })

  it('rejects nothing when the owner backs out', async () => {
    const { user, dialog } = await openRejectDialog()

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Reject Milestone' })).toBeNull(),
    )
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/milestones/m-1/status', expect.anything())
  })

  it('reports a rejection the service refused', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/status')) throw new Error('milestone is disputed')
      if (String(url).includes('/milestones')) return { success: true, data: [SUBMITTED, PENDING] }
      return { success: true, data: PROJECT }
    })
    const { user, dialog } = await openRejectDialog()

    await user.click(dialog.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(toastMessages()).toContain('milestone is disputed'))
  })
})

describe('the slide-over', () => {
  it('shows what the milestone is worth and when it is due', async () => {
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByText('Rp 4.000.000')).toBeDefined()
    expect(panel.getByText('Talent #1')).toBeDefined()
  })

  it('lists the deliverables the PRD asked for', async () => {
    stubApi([
      {
        ...SUBMITTED,
        metadata: {
          deliverables: [{ title: 'API documentation', type: 'document', expected: 'OpenAPI 3.1' }],
        },
      },
    ])
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByText('API documentation')).toBeDefined()
    expect(panel.getByText('OpenAPI 3.1')).toBeDefined()
  })

  it('says there are no attachments rather than showing an empty list', async () => {
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByText('No attachments yet')).toBeDefined()
  })

  it('closes and leaves the board behind it', async () => {
    const user = userEvent.setup()
    await render()
    await openDetail(user, 'Autentikasi')

    // Two controls share the name "Close": the backdrop and the panel button.
    const closers = screen.getAllByRole('button', { name: 'Close' })
    await user.click(closers[closers.length - 1])

    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2, name: 'Autentikasi' })).toBeNull(),
    )
    expect(screen.getByRole('heading', { name: 'Milestone Board' })).toBeDefined()
  })

  it('marks an integration milestone as one', async () => {
    stubApi([{ ...SUBMITTED, milestoneType: 'integration' }])
    const user = userEvent.setup()
    await render()

    const panel = await openDetail(user, 'Autentikasi')

    expect(panel.getByText('Integration Milestone')).toBeDefined()
  })
})

describe('the Gantt tab', () => {
  it('swaps the board for the chart and back', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('tab', { name: 'Gantt View' }))

    expect(await screen.findByText('gantt for p-1')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Submitted' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Milestone Board' }))

    expect(await screen.findByRole('heading', { name: 'Submitted' })).toBeDefined()
  })
})

describe('the way back to the project', () => {
  it('names the project it belongs to', async () => {
    await render()

    expect(
      (await screen.findByRole('link', { name: 'Toko Online Batik' })).getAttribute('href'),
    ).toBe('/projects/p-1')
  })

  it('falls back to a generic label when the project has not arrived', async () => {
    stubApi([SUBMITTED], null)

    await render()

    expect((await screen.findByRole('link', { name: 'Project' })).getAttribute('href')).toBe(
      '/projects/p-1',
    )
  })
})
