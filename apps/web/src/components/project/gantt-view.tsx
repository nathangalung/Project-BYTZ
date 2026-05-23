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

function safeDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return d
}

export function GanttView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')
  const {
    data: tasksData,
    isLoading: tasksLoading,
    isError: tasksError,
  } = useProjectTasks(projectId)
  const { data: milestonesData, isLoading: msLoading } = useProjectMilestones(projectId)

  const { ganttTasks, ganttLinks } = useMemo(() => {
    const tasks: SvarTask[] = []
    const links: SvarLink[] = []
    const now = new Date()
    const milestones = milestonesData ?? []

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
        progress:
          (m.status as string) === 'approved'
            ? 100
            : (m.status as string) === 'in_progress'
              ? 50
              : 0,
      })
    }

    // Tasks under milestones
    const rawTasks = tasksData?.tasks ?? []
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
        parent: task.milestoneId,
        progress,
      })
    }

    // Dependencies
    const deps = tasksData?.dependencies ?? []
    for (const d of deps) {
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
        <p className="text-sm text-on-surface-muted">{t('loading') ?? 'Loading...'}</p>
      </div>
    )
  }

  if (tasksError || ganttTasks.length === 0) {
    return (
      <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-8 text-center">
        <p className="text-sm text-on-surface-muted">
          {t('gantt_no_tasks') ??
            'No tasks available yet. Tasks will appear once defined per milestone.'}
        </p>
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
            {t('talents') ?? 'Talents'}
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
      <div
        className="overflow-hidden rounded-xl border border-outline-dim/20 bg-surface-bright"
        style={{ height: '600px' }}
      >
        <Willow>
          <Gantt
            tasks={ganttTasks}
            links={ganttLinks}
            scales={[
              { unit: 'month', step: 1, format: 'MMM yyyy' },
              { unit: 'day', step: 1, format: 'd' },
            ]}
            readonly
          />
        </Willow>
      </div>
    </div>
  )
}
