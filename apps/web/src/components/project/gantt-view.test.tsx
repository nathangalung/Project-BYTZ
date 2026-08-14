// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { GanttView } from './gantt-view'

/**
 * The SVAR chart is stubbed, and deliberately.
 *
 * It measures real layout and throws on a null client rect under jsdom, which
 * unwinds the whole tree - so a test asserting "the empty message is gone"
 * passes against a page that rendered nothing at all. Standing in for it turns
 * the seam into the thing worth testing: the task rows, the parent linkage and
 * the dependency links this view builds out of two API payloads.
 */
vi.mock('@svar-ui/react-gantt', () => ({
  Willow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Gantt: ({ tasks, links }: { tasks: unknown[]; links: unknown[] }) => (
    <div data-chart="" data-tasks={JSON.stringify(tasks)} data-links={JSON.stringify(links)} />
  ),
}))

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Task = {
  id: string
  title: string
  status: string
  startDate: string | null
  endDate: string | null
  milestoneId: string
  assignedTalentId: string | null
}

type ChartTask = {
  id: string
  text: string
  start: string
  end: string
  type: 'task' | 'summary' | 'milestone'
  parent?: string
  progress?: number
}

type ChartLink = { id: string; source: string; target: string; type: string }

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    title: 'Rancang skema database',
    status: 'in_progress',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-10T00:00:00.000Z',
    milestoneId: 'm-1',
    assignedTalentId: 'talent-a',
    ...overrides,
  }
}

type Payload = {
  tasks?: Task[]
  dependencies?: { id: string; taskId: string; dependsOnTaskId: string; type: string }[]
  milestones?: { id: string; title: string; status: string; dueDate: string | null }[]
}

function stubApi({ tasks = [], dependencies = [], milestones = [] }: Payload) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: String(url).includes('/tasks') ? { tasks, dependencies } : milestones,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  )
}

function stubTasksFailing() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/tasks')
          ? new Response(JSON.stringify({ error: { code: 'INTERNAL' } }), { status: 500 })
          : new Response(JSON.stringify({ success: true, data: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
      ),
    ),
  )
}

function renderGantt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <GanttView projectId="p-1" />
      </QueryClientProvider>,
    ),
  }
}

async function plot(payload: Payload) {
  stubApi(payload)
  const { client, container } = renderGantt()
  await vi.waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  const chart = container.querySelector('[data-chart]')
  if (!chart) throw new Error('the chart did not render')
  return {
    container,
    tasks: JSON.parse(chart.getAttribute('data-tasks') ?? '[]') as ChartTask[],
    links: JSON.parse(chart.getAttribute('data-links') ?? '[]') as ChartLink[],
  }
}

async function settle(client: QueryClient) {
  await vi.waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
}

describe('GanttView', () => {
  /**
   * The four-state contract. Two queries feed this chart, so the busy state
   * has to cover both - showing "no tasks yet" while the tasks are still in
   * flight tells the owner their plan is empty when it is not.
   */
  it('shows a busy state while either query is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const { container } = renderGantt()

    expect(screen.getByText(/Memuat|Loading/i)).toBeDefined()
    expect(container.querySelector('[data-chart]')).toBeNull()
  })

  it('says there is nothing to plot when there are no tasks', async () => {
    stubApi({})
    const { client, container } = renderGantt()
    await settle(client)

    expect(screen.getByText(/belum ada|no tasks/i)).toBeDefined()
    expect(container.querySelector('[data-chart]')).toBeNull()
  })

  /**
   * A failed fetch falls through to the same message as an empty plan, so the
   * owner is told there is nothing to show rather than left with a blank
   * panel. It does mean a server error is indistinguishable from an empty
   * schedule, which is a real limitation of this state rather than a bug.
   */
  it('falls back to the empty message when the tasks request fails', async () => {
    stubTasksFailing()
    const { client, container } = renderGantt()
    await settle(client)

    expect(screen.getByText(/belum ada|no tasks/i)).toBeDefined()
    expect(container.querySelector('[data-chart]')).toBeNull()
  })

  describe('the rows it plots', () => {
    it('gives each milestone a summary row and each task a row under it', async () => {
      const { tasks } = await plot({
        tasks: [task({ id: 't-1', title: 'Skema DB', milestoneId: 'm-1' })],
        milestones: [
          { id: 'm-1', title: 'Backend', status: 'in_progress', dueDate: '2026-08-15T00:00:00Z' },
        ],
      })

      expect(tasks).toHaveLength(2)
      expect(tasks[0]).toMatchObject({ id: 'm-1', text: 'Backend', type: 'summary' })
      expect(tasks[1]).toMatchObject({ id: 't-1', text: 'Skema DB', type: 'task', parent: 'm-1' })
    })

    /**
     * Progress drives the fill on each bar, so a completed task reading 50%
     * shows the owner work still outstanding that is already done.
     */
    it.each([
      ['completed', 100],
      ['in_progress', 50],
      ['pending', 0],
    ])('fills a %s task to %i per cent', async (status, expected) => {
      const { tasks } = await plot({ tasks: [task({ status })] })

      expect(tasks[0].progress).toBe(expected)
    })

    it.each([
      ['approved', 100],
      ['in_progress', 50],
      ['pending', 0],
    ])('fills an %s milestone to %i per cent', async (status, expected) => {
      const { tasks } = await plot({
        milestones: [{ id: 'm-1', title: 'Backend', status, dueDate: '2026-08-15T00:00:00Z' }],
      })

      expect(tasks[0].progress).toBe(expected)
    })

    it('opens a milestone summary a week before its due date', async () => {
      const { tasks } = await plot({
        milestones: [
          { id: 'm-1', title: 'Backend', status: 'pending', dueDate: '2026-08-15T00:00:00.000Z' },
        ],
      })

      expect(tasks[0].end).toBe('2026-08-15T00:00:00.000Z')
      expect(tasks[0].start).toBe('2026-08-08T00:00:00.000Z')
    })

    /**
     * A row with no dates yet would otherwise carry an Invalid Date and draw a
     * bar of NaN width. Falling back to a real date keeps it on the chart.
     */
    it.each([
      ['missing', null],
      ['unparseable', 'not-a-date'],
    ])('plots a task with a %s start date', async (_name, startDate) => {
      const { tasks } = await plot({ tasks: [task({ startDate, endDate: null })] })

      expect(tasks).toHaveLength(1)
      expect(Number.isNaN(Date.parse(tasks[0].start))).toBe(false)
      expect(Number.isNaN(Date.parse(tasks[0].end))).toBe(false)
    })

    it('plots a milestone with no due date', async () => {
      const { tasks } = await plot({
        milestones: [{ id: 'm-1', title: 'Backend', status: 'pending', dueDate: null }],
      })

      expect(Number.isNaN(Date.parse(tasks[0].end))).toBe(false)
    })

    it('names a milestone that arrived without a title', async () => {
      const { tasks } = await plot({
        milestones: [
          { id: 'm-1', title: null as unknown as string, status: 'pending', dueDate: null },
        ],
      })

      expect(tasks[0].text).toBe('Milestone')
    })
  })

  describe('the dependency links', () => {
    /**
     * The link points from the prerequisite to the dependent, and the type
     * decides which ends it joins. Reversing either draws the plan backwards.
     */
    it('points the link from the prerequisite to the dependent', async () => {
      const { links } = await plot({
        tasks: [task({ id: 't-1' }), task({ id: 't-2' })],
        dependencies: [
          { id: 'd-1', taskId: 't-2', dependsOnTaskId: 't-1', type: 'finish_to_start' },
        ],
      })

      expect(links).toEqual([{ id: 'd-1', source: 't-1', target: 't-2', type: 'e2s' }])
    })

    it.each([
      ['finish_to_start', 'e2s'],
      ['start_to_start', 's2s'],
      ['finish_to_finish', 'e2e'],
    ])('maps a %s dependency to %s', async (type, expected) => {
      const { links } = await plot({
        tasks: [task({ id: 't-1' }), task({ id: 't-2' })],
        dependencies: [{ id: 'd-1', taskId: 't-2', dependsOnTaskId: 't-1', type }],
      })

      expect(links[0].type).toBe(expected)
    })

    it('falls back to finish-to-start for a type it does not know', async () => {
      const { links } = await plot({
        tasks: [task()],
        dependencies: [{ id: 'd-1', taskId: 't-1', dependsOnTaskId: 't-1', type: 'start_to_end' }],
      })

      expect(links[0].type).toBe('e2s')
    })

    it('draws no links when there are no dependencies', async () => {
      const { links } = await plot({ tasks: [task()] })

      expect(links).toEqual([])
    })
  })

  describe('the talent legend', () => {
    /**
     * Each talent gets a swatch so their bars can be told apart. The colour is
     * derived from the talent id, so one talent must not be listed twice and
     * two talents must not collapse onto one entry.
     */
    it('lists one entry per distinct talent', async () => {
      await plot({
        tasks: [
          task({ id: 't-1', assignedTalentId: 'talent-a' }),
          task({ id: 't-2', assignedTalentId: 'talent-b' }),
          task({ id: 't-3', assignedTalentId: 'talent-a' }),
        ],
      })

      expect(screen.getByText('#1')).toBeDefined()
      expect(screen.getByText('#2')).toBeDefined()
      expect(screen.queryByText('#3')).toBeNull()
    })

    it('gives two talents two different swatches', async () => {
      const { container } = await plot({
        tasks: [
          task({ id: 't-1', assignedTalentId: 'talent-a' }),
          task({ id: 't-2', assignedTalentId: 'talent-b' }),
        ],
      })

      const swatches = Array.from(container.querySelectorAll('.h-3.w-3')).map(
        (el) => (el as HTMLElement).style.backgroundColor,
      )
      expect(swatches).toHaveLength(2)
      expect(swatches[0]).not.toBe(swatches[1])
    })

    it('gives the same talent the same swatch across renders', async () => {
      const first = await plot({ tasks: [task({ assignedTalentId: 'talent-a' })] })
      const firstColor = (first.container.querySelector('.h-3.w-3') as HTMLElement).style
        .backgroundColor

      const second = await plot({ tasks: [task({ assignedTalentId: 'talent-a' })] })
      const secondColor = (second.container.querySelector('.h-3.w-3') as HTMLElement).style
        .backgroundColor

      expect(secondColor).toBe(firstColor)
    })

    it('shows no legend when nothing is assigned yet', async () => {
      const { container } = await plot({ tasks: [task({ assignedTalentId: null })] })

      expect(screen.queryByText('#1')).toBeNull()
      expect(container.querySelectorAll('.h-3.w-3')).toHaveLength(0)
    })
  })
})
