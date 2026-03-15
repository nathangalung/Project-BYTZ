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

const MOCK_TIME_LOGS: TimeLogEntry[] = [
  {
    id: 'tl1',
    taskTitle: 'Backend API - Auth Endpoints',
    description: 'JWT authentication, session management, Google OAuth integration',
    date: '2026-03-15',
    durationMinutes: 195,
    isRunning: false,
  },
  {
    id: 'tl2',
    taskTitle: 'Backend API - Product CRUD',
    description: 'Product listing, detail, create, update, delete with Drizzle ORM',
    date: '2026-03-15',
    durationMinutes: 145,
    isRunning: false,
  },
  {
    id: 'tl3',
    taskTitle: 'Frontend - Product Catalog UI',
    description: 'Product grid layout, filter sidebar, search bar, responsive breakpoints',
    date: '2026-03-14',
    durationMinutes: 210,
    isRunning: false,
  },
  {
    id: 'tl4',
    taskTitle: 'Frontend - Product Detail Page',
    description: 'Image gallery, variant selector, add to cart, review section',
    date: '2026-03-14',
    durationMinutes: 165,
    isRunning: false,
  },
  {
    id: 'tl5',
    taskTitle: 'Database Schema Design',
    description: 'Product, order, user, subscription tables with Drizzle schema',
    date: '2026-03-13',
    durationMinutes: 240,
    isRunning: false,
  },
  {
    id: 'tl6',
    taskTitle: 'UI/UX - Design System Setup',
    description: 'Figma component library, color tokens, typography scale, spacing system',
    date: '2026-03-13',
    durationMinutes: 180,
    isRunning: false,
  },
  {
    id: 'tl7',
    taskTitle: 'UI/UX - Wireframes Review',
    description: 'Checkout flow, subscription management, admin inventory wireframes',
    date: '2026-03-12',
    durationMinutes: 120,
    isRunning: false,
  },
  {
    id: 'tl8',
    taskTitle: 'Project Kickoff & Setup',
    description: 'Monorepo configuration, Docker compose, CI/CD pipeline, Turborepo setup',
    date: '2026-03-11',
    durationMinutes: 300,
    isRunning: false,
  },
]

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

  const [timeLogs, setTimeLogs] = useState<TimeLogEntry[]>(MOCK_TIME_LOGS)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerTask, setTimerTask] = useState('')
  const [timerDescription, setTimerDescription] = useState('')
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
    setIsTimerRunning(true)
    setTimerSeconds(0)
  }, [timerTask])

  const handleStopTimer = useCallback(() => {
    setIsTimerRunning(false)
    const durationMinutes = Math.max(1, Math.round(timerSeconds / 60))
    const newEntry: TimeLogEntry = {
      id: `tl-${Date.now()}`,
      taskTitle: timerTask,
      description: timerDescription,
      date: new Date().toISOString().split('T')[0],
      durationMinutes,
      isRunning: false,
    }
    setTimeLogs((prev) => [newEntry, ...prev])
    setTimerTask('')
    setTimerDescription('')
    setTimerSeconds(0)
  }, [timerSeconds, timerTask, timerDescription])

  function handleManualSubmit() {
    const hours = Number.parseInt(manualHours || '0', 10)
    const mins = Number.parseInt(manualMinutes || '0', 10)
    const totalMinutes = hours * 60 + mins
    if (!manualTask.trim() || totalMinutes <= 0) return

    const newEntry: TimeLogEntry = {
      id: `tl-${Date.now()}`,
      taskTitle: manualTask,
      description: manualDescription,
      date: manualDate,
      durationMinutes: totalMinutes,
      isRunning: false,
    }
    setTimeLogs((prev) => [newEntry, ...prev])
    setManualTask('')
    setManualDescription('')
    setManualHours('')
    setManualMinutes('')
    setShowManualForm(false)
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

  if (projectLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-[#152e34]">
        <Loader2 className="h-8 w-8 animate-spin text-[#9fc26e]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#152e34] p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-[#5e677d] hover:text-[#9fc26e] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#f6f3ab] tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-[#9fc26e]" />
            Time Tracking
          </h1>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-[#3b526a] p-4 text-center border border-[#5e677d]/20">
            <Timer className="mx-auto mb-1.5 h-5 w-5 text-[#9fc26e]" />
            <p className="text-xs text-[#5e677d]">{t('today')}</p>
            <p className="mt-0.5 text-lg font-bold text-[#f6f3ab]">
              {formatDuration(todayTotalMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-[#3b526a] p-4 text-center border border-[#5e677d]/20">
            <BarChart3 className="mx-auto mb-1.5 h-5 w-5 text-[#e59a91]" />
            <p className="text-xs text-[#5e677d]">{t('this_week')}</p>
            <p className="mt-0.5 text-lg font-bold text-[#f6f3ab]">
              {formatDuration(weekTotalMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-[#3b526a] p-4 text-center border border-[#5e677d]/20">
            <FileText className="mx-auto mb-1.5 h-5 w-5 text-[#f6f3ab]" />
            <p className="text-xs text-[#5e677d]">{t('total_entries')}</p>
            <p className="mt-0.5 text-lg font-bold text-[#f6f3ab]">{timeLogs.length}</p>
          </div>
        </div>

        {/* Timer section */}
        <div className="mb-6 rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20">
          <h2 className="mb-4 text-sm font-semibold text-[#f6f3ab] flex items-center gap-2">
            <Timer className="h-4 w-4 text-[#9fc26e]" />
            Timer
          </h2>

          {/* Timer display */}
          <div className="mb-5 text-center">
            <p
              className={cn(
                'font-mono text-5xl font-bold tracking-wider',
                isTimerRunning ? 'text-[#9fc26e]' : 'text-[#f6f3ab]/30',
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
              className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2.5 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50 disabled:opacity-50"
            />
            <input
              type="text"
              value={timerDescription}
              onChange={(e) => setTimerDescription(e.target.value)}
              placeholder={t('description_optional_placeholder')}
              disabled={isTimerRunning}
              className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2.5 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50 disabled:opacity-50"
            />
          </div>

          {/* Timer button */}
          <div className="flex justify-center">
            {!isTimerRunning ? (
              <button
                type="button"
                onClick={handleStartTimer}
                disabled={!timerTask.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#9fc26e] px-8 py-3 text-sm font-bold text-[#0d1e28] hover:bg-[#9fc26e]/90 disabled:opacity-40 transition-colors"
              >
                <Play className="h-4 w-4" />
                {t('start')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopTimer}
                className="inline-flex items-center gap-2 rounded-lg bg-[#e59a91] px-8 py-3 text-sm font-bold text-[#0d1e28] hover:bg-[#e59a91]/90 transition-colors"
              >
                <Square className="h-4 w-4" />
                {t('stop')}
              </button>
            )}
          </div>
        </div>

        {/* Manual entry toggle */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#f6f3ab]">{t('time_log')}</h2>
          <button
            type="button"
            onClick={() => setShowManualForm(!showManualForm)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#5e677d]/30 px-3 py-1.5 text-xs font-medium text-[#5e677d] hover:bg-[#3b526a] hover:text-[#f6f3ab] transition-colors"
          >
            <Plus className="h-3 w-3" />
            {t('manual_entry')}
          </button>
        </div>

        {/* Manual entry form */}
        {showManualForm && (
          <div className="mb-4 rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#f6f3ab]">{t('add_manual_entry')}</h3>
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="rounded p-1 text-[#5e677d] hover:text-[#f6f3ab] transition-colors"
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
                className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50"
              />
              <input
                type="text"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
                placeholder={t('description_optional_placeholder')}
                className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50"
              />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="manual-date"
                    className="mb-1 block text-xs font-medium text-[#5e677d]"
                  >
                    <Calendar className="mr-1 inline h-3 w-3" />
                    {t('date')}
                  </label>
                  <input
                    id="manual-date"
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2 text-sm text-[#f6f3ab] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manual-hours"
                    className="mb-1 block text-xs font-medium text-[#5e677d]"
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
                    className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manual-minutes"
                    className="mb-1 block text-xs font-medium text-[#5e677d]"
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
                    className="w-full rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50"
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
                  className="rounded-lg border border-[#5e677d]/30 px-4 py-2 text-sm font-medium text-[#5e677d] hover:bg-[#112630] hover:text-[#f6f3ab] transition-colors"
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-semibold text-[#0d1e28] hover:bg-[#9fc26e]/90 disabled:opacity-40 transition-colors"
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
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#3b526a] border border-[#5e677d]/20 py-12">
            <Clock className="mb-3 h-8 w-8 text-[#5e677d]" />
            <p className="text-sm text-[#5e677d]">{t('no_time_entries')}</p>
            <p className="mt-1 text-xs text-[#5e677d]/60">{t('no_time_entries_hint')}</p>
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
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5e677d]">
                      {formatShortDate(date)}
                    </h3>
                    <span className="text-xs font-bold text-[#9fc26e]">
                      {formatDuration(dayTotal)}
                    </span>
                  </div>

                  {/* Entries */}
                  <div className="space-y-1">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 rounded-lg bg-[#112630] px-4 py-3 border border-[#5e677d]/10"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3b526a]">
                          <Clock className="h-4 w-4 text-[#9fc26e]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#f6f3ab]">
                            {log.taskTitle}
                          </p>
                          {log.description && (
                            <p className="truncate text-xs text-[#5e677d]">{log.description}</p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-[#3b526a] px-3 py-1 text-xs font-bold text-[#f6f3ab] border border-[#5e677d]/15">
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
