import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Clock,
  FileText,
  Loader2,
  Play,
  Plus,
  Square,
  Timer,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDuration, formatShortDate } from '@/components/project/time-tracking/format'
import {
  useCreateTimeLog,
  useStopTimer,
  useTimeLogSummary,
  useTimeLogs,
} from '@/components/project/time-tracking/hooks'
import type { TimeLogEntry } from '@/components/project/time-tracking/shared'
import { TimerDisplay } from '@/components/project/time-tracking/timer-display'
import { useProject, useProjectTasks } from '@/hooks/use-projects'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/projects/$projectId/time-tracking')({
  component: TimeTrackingPage,
})

// The chart only renders once a summary exists, so recharts can load with it.
const TalentHoursChart = lazy(() =>
  import('@/components/project/time-tracking/talent-hours-chart').then((m) => ({
    default: m.TalentHoursChart,
  })),
)

function TimeTrackingPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const { projectId } = Route.useParams()
  // Logging time needs a talent profile; the owner's view is read-only.
  const isTalent = useAuthStore((s) => s.user?.role === 'talent')
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const {
    data: timeLogs = [],
    isLoading: timeLogsLoading,
    isError: timeLogsError,
    refetch: refetchTimeLogs,
  } = useTimeLogs(projectId)
  const { data: summary = [] } = useTimeLogSummary(projectId)
  // Real tasks only: time_logs.task_id is an FK, so free text cannot work.
  const { data: tasksData } = useProjectTasks(projectId)
  const taskOptions = tasksData?.tasks ?? []
  const createTimeLog = useCreateTimeLog(projectId)
  const stopTimerMutation = useStopTimer(projectId)

  // Aggregate summary rows by talent for the bar chart
  const talentTotals = useMemo(() => {
    const map = new Map<string, { name: string; totalHours: number }>()
    for (const row of summary) {
      const key = row.talentId
      const existing = map.get(key)
      const hours = row.totalMinutes / 60
      if (existing) {
        existing.totalHours += hours
      } else {
        map.set(key, {
          name: row.talentName || row.talentId.slice(0, 6),
          totalHours: hours,
        })
      }
    }
    return Array.from(map.values()).map((v) => ({
      name: v.name,
      totalHours: Math.round(v.totalHours * 100) / 100,
    }))
  }, [summary])

  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [timerTask, setTimerTask] = useState('')
  const [timerDescription, setTimerDescription] = useState('')
  const [activeTimeLogId, setActiveTimeLogId] = useState<string | null>(null)
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualTask, setManualTask] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0])
  const [manualHours, setManualHours] = useState('')
  const [manualMinutes, setManualMinutes] = useState('')

  const handleStartTimer = useCallback(() => {
    if (!timerTask.trim()) return
    const now = new Date().toISOString()
    setTimerStartedAt(now)
    setIsTimerRunning(true)

    // Create an open-ended time log entry (no endedAt)
    createTimeLog.mutate(
      {
        taskId: timerTask,
        startedAt: now,
        description: timerDescription || undefined,
      },
      {
        onSuccess: (res) => {
          if (res?.data?.id) {
            setActiveTimeLogId(res.data.id)
          }
        },
        onError: () => {
          setIsTimerRunning(false)
          setTimerStartedAt(null)
        },
      },
    )
  }, [timerTask, timerDescription, createTimeLog])

  const handleStopTimer = useCallback(() => {
    setIsTimerRunning(false)

    if (activeTimeLogId) {
      // Stop the timer via API
      stopTimerMutation.mutate(activeTimeLogId)
    } else if (timerStartedAt) {
      // Fallback: create a completed entry if we don't have an active log ID.
      // Elapsed comes from the start timestamp; the tick lives in TimerDisplay.
      const endedAt = new Date().toISOString()
      const elapsedMs = Date.now() - new Date(timerStartedAt).getTime()
      const durationMinutes = Math.max(1, Math.round(elapsedMs / 60_000))
      createTimeLog.mutate({
        taskId: timerTask,
        startedAt: timerStartedAt,
        endedAt,
        durationMinutes,
        description: timerDescription || undefined,
      })
    }

    setTimerTask('')
    setTimerDescription('')
    setActiveTimeLogId(null)
    setTimerStartedAt(null)
  }, [
    timerTask,
    timerDescription,
    activeTimeLogId,
    timerStartedAt,
    createTimeLog,
    stopTimerMutation,
  ])

  function handleManualSubmit() {
    const hours = Number.parseInt(manualHours || '0', 10)
    const mins = Number.parseInt(manualMinutes || '0', 10)
    const totalMinutes = hours * 60 + mins
    if (!manualTask.trim() || totalMinutes <= 0) return

    const startedAt = new Date(`${manualDate}T09:00:00`).toISOString()
    const endedAt = new Date(new Date(startedAt).getTime() + totalMinutes * 60_000).toISOString()

    createTimeLog.mutate(
      {
        taskId: manualTask,
        startedAt,
        endedAt,
        durationMinutes: totalMinutes,
        description: manualDescription || undefined,
      },
      {
        onSuccess: () => {
          setManualTask('')
          setManualDescription('')
          setManualHours('')
          setManualMinutes('')
          setShowManualForm(false)
        },
      },
    )
  }

  // Weekly and daily totals plus the date grouping, derived once per fetch
  const { weekTotalMinutes, todayTotalMinutes, logsByDate, sortedDates } = useMemo(() => {
    const today = new Date()
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay())
    const weekStartStr = weekStart.toISOString().split('T')[0]
    const todayStr = today.toISOString().split('T')[0]

    let weekMinutes = 0
    let todayMinutes = 0
    const byDate: Record<string, TimeLogEntry[]> = {}
    for (const log of timeLogs) {
      if (log.date >= weekStartStr) weekMinutes += log.durationMinutes
      if (log.date === todayStr) todayMinutes += log.durationMinutes
      if (!byDate[log.date]) byDate[log.date] = []
      byDate[log.date].push(log)
    }

    return {
      weekTotalMinutes: weekMinutes,
      todayTotalMinutes: todayMinutes,
      logsByDate: byDate,
      sortedDates: Object.keys(byDate).sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime(),
      ),
    }
  }, [timeLogs])

  if (projectLoading || timeLogsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  if (timeLogsError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 bg-surface">
        <p className="text-sm text-on-surface-muted">{tc('error_loading')}</p>
        <button
          type="button"
          onClick={() => refetchTimeLogs()}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          {tc('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-brand-text transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-brand-text tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-success-600" />
            {t('time_tracking')}
          </h1>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-surface-bright p-4 text-center border border-outline-dim/20">
            <Timer className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
            <p className="text-xs text-on-surface-muted">{t('today')}</p>
            <p className="mt-0.5 text-lg font-bold text-brand-text">
              {formatDuration(todayTotalMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-surface-bright p-4 text-center border border-outline-dim/20">
            <BarChart3 className="mx-auto mb-1.5 h-5 w-5 text-accent-coral-600" />
            <p className="text-xs text-on-surface-muted">{t('this_week')}</p>
            <p className="mt-0.5 text-lg font-bold text-brand-text">
              {formatDuration(weekTotalMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-surface-bright p-4 text-center border border-outline-dim/20">
            <FileText className="mx-auto mb-1.5 h-5 w-5 text-brand-text" />
            <p className="text-xs text-on-surface-muted">{t('total_entries')}</p>
            <p className="mt-0.5 text-lg font-bold text-brand-text">{timeLogs.length}</p>
          </div>
        </div>

        {/* Timer section (talent only; owner monitors read-only) */}
        {isTalent && (
          <div className="mb-6 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
            <h2 className="mb-4 text-sm font-semibold text-brand-text flex items-center gap-2">
              <Timer className="h-4 w-4 text-success-600" />
              {t('timer')}
            </h2>

            {/* Timer display */}
            <div className="mb-5 text-center">
              <TimerDisplay running={isTimerRunning} />
            </div>

            {/* Timer inputs: real tasks only, the id feeds an FK */}
            <div className="mb-4 space-y-2">
              <select
                value={timerTask}
                onChange={(e) => setTimerTask(e.target.value)}
                disabled={isTimerRunning}
                className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-brand-text focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30 disabled:opacity-50"
              >
                <option value="">{t('select_task')}</option>
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={timerDescription}
                onChange={(e) => setTimerDescription(e.target.value)}
                placeholder={t('description_optional_placeholder')}
                disabled={isTimerRunning}
                className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-brand-text placeholder:text-on-surface-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30 disabled:opacity-50"
              />
            </div>

            {/* Timer button */}
            <div className="flex justify-center">
              {!isTimerRunning ? (
                <button
                  type="button"
                  onClick={handleStartTimer}
                  disabled={!timerTask.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-8 py-3 text-sm font-bold text-white hover:bg-brand/90 disabled:opacity-40 transition-colors"
                >
                  <Play className="h-4 w-4" />
                  {t('start')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStopTimer}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-8 py-3 text-sm font-bold text-white hover:bg-accent-coral-500/90 transition-colors"
                >
                  <Square className="h-4 w-4" />
                  {t('stop')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Aggregate summary (per talent, per milestone) */}
        {summary.length > 0 && (
          <div className="mb-6 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
            <h2 className="mb-4 text-sm font-semibold text-brand-text flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-accent-coral-600" />
              {t('time_summary_title')}
            </h2>

            {/* Bar chart - hours per talent */}
            {talentTotals.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-xs font-medium text-on-surface-muted">{t('by_talent')}</p>
                <Suspense
                  fallback={
                    <div className="h-56 w-full animate-pulse rounded-lg bg-surface-container" />
                  }
                >
                  <TalentHoursChart data={talentTotals} />
                </Suspense>
              </div>
            )}

            {/* Table - per talent, per milestone */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-dim/20 text-left">
                    <th className="pb-2 pr-3 text-xs font-medium text-on-surface-muted">
                      {t('talent_name')}
                    </th>
                    <th className="pb-2 pr-3 text-xs font-medium text-on-surface-muted">
                      {t('milestone_title')}
                    </th>
                    <th className="pb-2 pr-3 text-right text-xs font-medium text-on-surface-muted">
                      {t('total_hours')}
                    </th>
                    <th className="pb-2 text-right text-xs font-medium text-on-surface-muted">
                      {t('entry_count')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr
                      key={`${row.talentId}-${row.milestoneId ?? 'none'}`}
                      className="border-b border-outline-dim/10 last:border-b-0"
                    >
                      <td className="py-2 pr-3 text-brand-text">
                        {row.talentName || row.talentId.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-3 text-on-surface-muted">
                        {row.milestoneTitle || t('untitled_milestone')}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-brand-text">
                        {(row.totalMinutes / 60).toFixed(2)}
                      </td>
                      <td className="py-2 text-right text-on-surface-muted">{row.entryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Manual entry toggle (adding entries is talent only) */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-text">{t('time_log')}</h2>
          {isTalent && (
            <button
              type="button"
              onClick={() => setShowManualForm(!showManualForm)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/20 px-3 py-1.5 text-xs font-medium text-on-surface-muted hover:bg-surface-bright hover:text-brand-text transition-colors"
            >
              <Plus className="h-3 w-3" />
              {t('manual_entry')}
            </button>
          )}
        </div>

        {/* Manual entry form */}
        {isTalent && showManualForm && (
          <div className="mb-4 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-brand-text">{t('add_manual_entry')}</h3>
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="rounded p-1 text-on-surface-muted hover:text-brand-text transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <select
                value={manualTask}
                onChange={(e) => setManualTask(e.target.value)}
                className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-brand-text focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
              >
                <option value="">{t('select_task')}</option>
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
                placeholder={t('description_optional_placeholder')}
                className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-brand-text placeholder:text-on-surface-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
              />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="manual-date"
                    className="mb-1 block text-xs font-medium text-on-surface-muted"
                  >
                    <Calendar className="mr-1 inline h-3 w-3" />
                    {t('date')}
                  </label>
                  <input
                    id="manual-date"
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-brand-text focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manual-hours"
                    className="mb-1 block text-xs font-medium text-on-surface-muted"
                  >
                    {t('hours')}
                  </label>
                  <input
                    id="manual-hours"
                    type="number"
                    min="0"
                    max="24"
                    value={manualHours}
                    onChange={(e) => setManualHours(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-brand-text placeholder:text-on-surface-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manual-minutes"
                    className="mb-1 block text-xs font-medium text-on-surface-muted"
                  >
                    {t('minutes')}
                  </label>
                  <input
                    id="manual-minutes"
                    type="number"
                    min="0"
                    max="59"
                    value={manualMinutes}
                    onChange={(e) => setManualMinutes(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-brand-text placeholder:text-on-surface-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowManualForm(false)
                    setManualTask('')
                    setManualDescription('')
                    setManualHours('')
                    setManualMinutes('')
                  }}
                  className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container hover:text-brand-text transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleManualSubmit}
                  disabled={
                    !manualTask.trim() ||
                    (Number.parseInt(manualHours || '0', 10) === 0 &&
                      Number.parseInt(manualMinutes || '0', 10) === 0)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  {t('add_entry')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Time log grouped by date */}
        {sortedDates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface-bright border border-outline-dim/20 py-12">
            <Clock className="mb-3 h-8 w-8 text-on-surface-muted" />
            <p className="text-sm text-on-surface-muted">{t('no_time_entries')}</p>
            <p className="mt-1 text-xs text-on-surface-muted/60">{t('no_time_entries_hint')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {sortedDates.map((date) => {
              const logs = logsByDate[date]
              const dayTotal = logs.reduce((sum, log) => sum + log.durationMinutes, 0)
              return (
                <div key={date}>
                  {/* Date header */}
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
                      {formatShortDate(date)}
                    </h3>
                    <span className="text-xs font-bold text-success-600">
                      {formatDuration(dayTotal)}
                    </span>
                  </div>

                  {/* Entries */}
                  <div className="space-y-1">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 rounded-lg bg-surface-container px-4 py-3 border border-outline-dim/10"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-bright">
                          <Clock className="h-4 w-4 text-success-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-brand-text">
                            {log.taskTitle}
                          </p>
                          {log.description && (
                            <p className="truncate text-xs text-on-surface-muted">
                              {log.description}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-surface-bright px-3 py-1 text-xs font-bold text-brand-text border border-outline-dim/10">
                          {formatDuration(log.durationMinutes)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
