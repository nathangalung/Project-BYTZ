import type { ApiResponse } from '@kerjacus/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProject } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/time-tracking')({
  component: TimeTrackingPage,
})

type TimeLogEntry = {
  id: string
  taskTitle: string
  description: string
  date: string
  durationMinutes: number
  isRunning: boolean
}

type ApiTimeLog = {
  id: string
  taskId: string
  talentId: string
  startedAt: string
  endedAt: string | null
  durationMinutes: number | null
  description: string | null
  createdAt: string
  taskTitle: string
}

function useTimeLogs(projectId: string) {
  return useQuery({
    queryKey: ['time-logs', projectId],
    queryFn: async (): Promise<TimeLogEntry[]> => {
      const res = await fetch(`/api/v1/time-logs/project/${projectId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return []
      const json: ApiResponse<ApiTimeLog[]> = await res.json()
      if (!json.success || !json.data) return []

      return json.data.map((log) => ({
        id: log.id,
        taskTitle: log.taskTitle || 'Untitled Task',
        description: log.description ?? '',
        date: log.startedAt.split('T')[0],
        durationMinutes: log.durationMinutes ?? 0,
        isRunning: !log.endedAt,
      }))
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 30000,
  })
}

function useCreateTimeLog(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      taskId: string
      talentId: string
      startedAt: string
      endedAt?: string
      durationMinutes?: number
      description?: string
    }) => {
      const res = await fetch('/api/v1/time-logs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Request failed: ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-logs', projectId] })
    },
  })
}

function useStopTimer(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (timeLogId: string) => {
      const res = await fetch(`/api/v1/time-logs/${timeLogId}/stop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Request failed: ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-logs', projectId] })
    },
  })
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function formatTimerDisplay(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatShortDate(dateStr: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(dateStr))
}

function TimeTrackingPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: timeLogs = [], isLoading: timeLogsLoading } = useTimeLogs(projectId)
  const createTimeLog = useCreateTimeLog(projectId)
  const stopTimerMutation = useStopTimer(projectId)

  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isTimerRunning) {
      intervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1)
      }, 1000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isTimerRunning])

  const handleStartTimer = useCallback(() => {
    if (!timerTask.trim()) return
    const now = new Date().toISOString()
    setTimerStartedAt(now)
    setIsTimerRunning(true)
    setTimerSeconds(0)

    // Create an open-ended time log entry (no endedAt)
    createTimeLog.mutate(
      {
        taskId: timerTask,
        talentId: 'current-user', // placeholder, backend should resolve from session
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
      // Fallback: create a completed entry if we don't have an active log ID
      const endedAt = new Date().toISOString()
      const durationMinutes = Math.max(1, Math.round(timerSeconds / 60))
      createTimeLog.mutate({
        taskId: timerTask,
        talentId: 'current-user',
        startedAt: timerStartedAt,
        endedAt,
        durationMinutes,
        description: timerDescription || undefined,
      })
    }

    setTimerTask('')
    setTimerDescription('')
    setTimerSeconds(0)
    setActiveTimeLogId(null)
    setTimerStartedAt(null)
  }, [
    timerSeconds,
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
        talentId: 'current-user',
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

  // Weekly summary
  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay())
  const weekStartStr = weekStart.toISOString().split('T')[0]

  const weekLogs = timeLogs.filter((log) => log.date >= weekStartStr)
  const weekTotalMinutes = weekLogs.reduce((sum, log) => sum + log.durationMinutes, 0)
  const todayStr = today.toISOString().split('T')[0]
  const todayLogs = timeLogs.filter((log) => log.date === todayStr)
  const todayTotalMinutes = todayLogs.reduce((sum, log) => sum + log.durationMinutes, 0)

  // Group logs by date
  const logsByDate = timeLogs.reduce<Record<string, TimeLogEntry[]>>((acc, log) => {
    if (!acc[log.date]) acc[log.date] = []
    acc[log.date].push(log)
    return acc
  }, {})
  const sortedDates = Object.keys(logsByDate).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  )

  if (projectLoading || timeLogsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
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
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary-600 tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-success-600" />
            {t('time_tracking', 'Pelacakan Waktu')}
          </h1>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-surface-bright p-4 text-center border border-outline-dim/20">
            <Timer className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
            <p className="text-xs text-on-surface-muted">{t('today')}</p>
            <p className="mt-0.5 text-lg font-bold text-primary-600">
              {formatDuration(todayTotalMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-surface-bright p-4 text-center border border-outline-dim/20">
            <BarChart3 className="mx-auto mb-1.5 h-5 w-5 text-accent-coral-600" />
            <p className="text-xs text-on-surface-muted">{t('this_week')}</p>
            <p className="mt-0.5 text-lg font-bold text-primary-600">
              {formatDuration(weekTotalMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-surface-bright p-4 text-center border border-outline-dim/20">
            <FileText className="mx-auto mb-1.5 h-5 w-5 text-primary-600" />
            <p className="text-xs text-on-surface-muted">{t('total_entries')}</p>
            <p className="mt-0.5 text-lg font-bold text-primary-600">{timeLogs.length}</p>
          </div>
        </div>

        {/* Timer section */}
        <div className="mb-6 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
          <h2 className="mb-4 text-sm font-semibold text-primary-600 flex items-center gap-2">
            <Timer className="h-4 w-4 text-success-600" />
            {t('timer', 'Timer')}
          </h2>

          {/* Timer display */}
          <div className="mb-5 text-center">
            <p
              className={cn(
                'font-mono text-5xl font-bold tracking-wider',
                isTimerRunning ? 'text-success-600' : 'text-primary-600/30',
              )}
            >
              {formatTimerDisplay(timerSeconds)}
            </p>
          </div>

          {/* Timer inputs */}
          <div className="mb-4 space-y-2">
            <input
              type="text"
              value={timerTask}
              onChange={(e) => setTimerTask(e.target.value)}
              placeholder={t('task_name_placeholder')}
              disabled={isTimerRunning}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30 disabled:opacity-50"
            />
            <input
              type="text"
              value={timerDescription}
              onChange={(e) => setTimerDescription(e.target.value)}
              placeholder={t('description_optional_placeholder')}
              disabled={isTimerRunning}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30 disabled:opacity-50"
            />
          </div>

          {/* Timer button */}
          <div className="flex justify-center">
            {!isTimerRunning ? (
              <button
                type="button"
                onClick={handleStartTimer}
                disabled={!timerTask.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-8 py-3 text-sm font-bold text-white hover:bg-primary-600/90 disabled:opacity-40 transition-colors"
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

        {/* Manual entry toggle */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary-600">{t('time_log')}</h2>
          <button
            type="button"
            onClick={() => setShowManualForm(!showManualForm)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/20 px-3 py-1.5 text-xs font-medium text-on-surface-muted hover:bg-surface-bright hover:text-primary-600 transition-colors"
          >
            <Plus className="h-3 w-3" />
            {t('manual_entry')}
          </button>
        </div>

        {/* Manual entry form */}
        {showManualForm && (
          <div className="mb-4 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary-600">{t('add_manual_entry')}</h3>
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="rounded p-1 text-on-surface-muted hover:text-primary-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={manualTask}
                onChange={(e) => setManualTask(e.target.value)}
                placeholder={t('task_name_placeholder')}
                className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              />
              <input
                type="text"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
                placeholder={t('description_optional_placeholder')}
                className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
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
                    className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-primary-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
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
                    className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
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
                    className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
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
                  className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container hover:text-primary-600 transition-colors"
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600/90 disabled:opacity-40 transition-colors"
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
                          <p className="truncate text-sm font-semibold text-primary-600">
                            {log.taskTitle}
                          </p>
                          {log.description && (
                            <p className="truncate text-xs text-on-surface-muted">
                              {log.description}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-surface-bright px-3 py-1 text-xs font-bold text-primary-600 border border-outline-dim/10">
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
