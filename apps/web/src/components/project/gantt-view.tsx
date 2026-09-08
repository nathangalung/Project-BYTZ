import { Gantt, Willow } from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/style.css'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectMilestones, useProjectTasks } from '@/hooks/use-projects'

type SvarTask = {
  id: string
  text: string
  start: Date
  end: Date
  duration?: number
  type: 'task' | 'summary' | 'milestone'
  parent?: string | number
  progress?: number
  /**
   * Summary rows are collapsed unless this is literally `true`.
   *
   * gantt-store flattens the tree with `n.open === true && recurse(n.data)`,
   * so every task under a milestone was parsed, attached, and then never
   * reached the rendered array. The chart drew four milestone bars and none
   * of the work under them, which reads as a Gantt that does not load.
   */
  open?: boolean
}

type SvarLink = {
  id: string
  source: string
  target: string
  type: 's2s' | 's2e' | 'e2s' | 'e2e'
}

// Brand palette for color-coding tasks per talent (used inline-styled via taskTemplate eventually)
const TALENT_COLORS = ['#1d4a54', '#e59a91', '#9fc26e', '#f6f3ab', '#3b526a', '#7fa84e', '#d47367']

function colorForTalent(talentId: string | null | undefined): string {
  if (!talentId) return TALENT_COLORS[0]
  let hash = 0
  for (let i = 0; i < talentId.length; i++) {
    hash = (hash << 5) - hash + talentId.charCodeAt(i)
    hash |= 0
  }
  return TALENT_COLORS[Math.abs(hash) % TALENT_COLORS.length]
}

function depTypeToSvar(type: string): SvarLink['type'] {
  if (type === 'start_to_start') return 's2s'
  if (type === 'finish_to_finish') return 'e2e'
  return 'e2s' // finish_to_start
}

/**
 * Scale headers, formatted here rather than declared as a pattern.
 *
 * gantt-store reads a scale's `format` as `typeof f === 'function' ? f(a, b) :
 * f`, so a string is printed verbatim: the timeline header literally read
 * "MMM yyyy" and "d" across every column. The type allows a string, the
 * runtime never parses one.
 */
function buildScales(locale: string) {
  const month = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' })
  return [
    { unit: 'month' as const, step: 1, format: (date: Date) => month.format(date) },
    { unit: 'day' as const, step: 1, format: (date: Date) => String(date.getDate()) },
  ]
}

function safeDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return d
}

export function GanttView({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const scales = useMemo(() => buildScales(i18n.language), [i18n.language])
  const {
    data: tasksData,
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useProjectTasks(projectId)
  const {
    data: milestonesData,
    isLoading: msLoading,
    isError: msError,
    refetch: refetchMilestones,
  } = useProjectMilestones(projectId)

  const { ganttTasks, ganttLinks } = useMemo(() => {
    const tasks: SvarTask[] = []
    const links: SvarLink[] = []
    const now = new Date()
    const milestones = milestonesData ?? []
    const rawTasks = tasksData?.tasks ?? []

    // Which milestones actually have work under them. `open` may only be set
    // on those: the store's flatten reads `open === true && recurse(n.data)`
    // and a childless branch carries `data: null`, so an open empty summary
    // throws inside the store and the whole panel hits its error boundary.
    const milestonesWithTasks = new Set(rawTasks.map((task) => task.milestoneId))

    // Milestones as summary rows
    for (const m of milestones as Array<Record<string, unknown>>) {
      const id = m.id as string
      const dueDate = safeDate(m.dueDate as string | null, now)
      // Summary start: earliest task start under it, or 7 days before due
      const start = new Date(dueDate)
      start.setDate(start.getDate() - 7)
      tasks.push({
        id,
        text: (m.title as string) ?? 'Milestone',
        start,
        end: dueDate,
        type: 'summary',
        open: milestonesWithTasks.has(id),
        progress:
          (m.status as string) === 'approved'
            ? 100
            : (m.status as string) === 'in_progress'
              ? 50
              : 0,
      })
    }

    // Tasks under milestones. A parent that is not in this list is dropped by
    // the store's tree parse without a word, so the row would simply be absent
    // from a chart that otherwise looks complete. Attaching it at the root
    // instead keeps the work visible.
    const milestoneIds = new Set(tasks.map((t) => t.id))
    for (const task of rawTasks) {
      const start = safeDate(task.startDate, now)
      const end = safeDate(task.endDate, new Date(start.getTime() + 24 * 60 * 60 * 1000))
      const progress = task.status === 'completed' ? 100 : task.status === 'in_progress' ? 50 : 0
      tasks.push({
        id: task.id,
        text: task.title,
        start,
        end,
        type: 'task',
        parent: milestoneIds.has(task.milestoneId) ? task.milestoneId : undefined,
        progress,
      })
    }

    // Dependencies. A link to a row the chart does not hold draws from nowhere,
    // so only links whose both ends are present are passed on.
    const taskIds = new Set(rawTasks.map((t) => t.id))
    const deps = tasksData?.dependencies ?? []
    for (const d of deps) {
      if (!taskIds.has(d.dependsOnTaskId) || !taskIds.has(d.taskId)) continue
      links.push({
        id: d.id,
        source: d.dependsOnTaskId,
        target: d.taskId,
        type: depTypeToSvar(d.type),
      })
    }

    return { ganttTasks: tasks, ganttLinks: links }
  }, [tasksData, milestonesData])

  const isLoading = tasksLoading || msLoading

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright">
        <p className="text-sm text-on-surface-muted">{t('loading', 'Loading...')}</p>
      </div>
    )
  }

  // A failed fetch is not an empty chart. Either query failing blanks the whole
  // panel rather than drawing the partial state the four-state pattern asks
  // for: every task row carries `parent: task.milestoneId`, so rendering tasks
  // against `milestones: []` gives SVAR parents that do not exist and links
  // that hang off nothing.
  if (tasksError || msError) {
    return (
      <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-8 text-center">
        <p className="text-sm text-on-surface-muted">{t('gantt_load_failed')}</p>
        <button
          type="button"
          onClick={() => {
            if (tasksError) void refetchTasks()
            if (msError) void refetchMilestones()
          }}
          className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {tCommon('retry')}
        </button>
      </div>
    )
  }

  if (ganttTasks.length === 0) {
    return (
      <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-8 text-center">
        <p className="text-sm text-on-surface-muted">{t('gantt_no_tasks')}</p>
      </div>
    )
  }

  // Legend: distinct talents
  const rawTasks = tasksData?.tasks ?? []
  const distinctTalents = Array.from(
    new Set(rawTasks.map((t) => t.assignedTalentId).filter((id): id is string => !!id)),
  )

  return (
    <div className="space-y-3">
      {distinctTalents.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-dim/10 bg-surface-bright px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
            {t('talents', 'Talents')}
          </span>
          {distinctTalents.map((id, idx) => (
            <span key={id} className="flex items-center gap-1.5 text-xs text-on-surface-muted">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: colorForTalent(id) }}
              />
              {`#${idx + 1}`}
            </span>
          ))}
        </div>
      )}
      <div className="h-[600px] overflow-hidden rounded-xl border border-outline-dim/20 bg-surface-bright">
        <Willow>
          <Gantt tasks={ganttTasks} links={ganttLinks} scales={scales} readonly />
        </Willow>
      </div>
    </div>
  )
}
