import { isMatchingSlaStatus, type MatchingSla, matchingSlaFromLogs } from '@kerjacus/shared'
import { AlertTriangle, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStatusLogs } from '@/hooks/use-projects'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export type DurationParts = {
  days: number
  hours: number
  minutes: number
}

/**
 * Split a positive span into whole days, hours and minutes.
 *
 * Callers pass the absolute value, so a breach reads "overdue by 3 hours"
 * instead of "-3 hours".
 */
export function splitDuration(ms: number): DurationParts {
  const total = Math.max(0, ms)
  return {
    days: Math.floor(total / DAY_MS),
    hours: Math.floor((total % DAY_MS) / HOUR_MS),
    minutes: Math.floor((total % HOUR_MS) / MINUTE_MS),
  }
}

/** Re-render on a fixed interval so the countdown moves. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

type Props = {
  projectId: string
  status: string
  teamSize: number
}

/**
 * Countdown against the matching SLA promised in the product: 72 hours for a
 * single talent, 14 days to assemble a team.
 *
 * Renders nothing outside `matching` and `team_forming`, and nothing when the
 * status log has no entry into either, which is the case for a project seeded
 * straight into a later state.
 */
export function MatchingSlaBanner({ projectId, status, teamSize }: Props) {
  const { t } = useTranslation('matching')
  const active = isMatchingSlaStatus(status)
  const { data: logs } = useProjectStatusLogs(projectId, active)
  const now = useNow(MINUTE_MS)

  if (!active || !logs) return null

  const sla: MatchingSla | null = matchingSlaFromLogs(logs, teamSize, now)
  if (!sla) return null

  const { days, hours, minutes } = splitDuration(Math.abs(sla.remainingMs))
  const span = [
    days > 0 ? t('sla_days', { count: days }) : null,
    days > 0 || hours > 0 ? t('sla_hours', { count: hours }) : null,
    days > 0 ? null : t('sla_minutes', { count: minutes }),
  ]
    .filter(Boolean)
    .join(' ')

  const deadline = new Date(sla.deadline).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  if (sla.breached) {
    return (
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent-coral-500/30 bg-accent-coral-500/5 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-accent-coral-600" />
        <div>
          <p className="text-sm font-semibold text-accent-coral-600">{t('sla_breached')}</p>
          <p className="mt-0.5 text-sm text-on-surface-muted">{t('sla_breached_desc', { span })}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-outline-dim/20 bg-surface-container p-4">
      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
      <div>
        <p className="text-sm font-semibold text-primary-600">
          {t('matching_sla')} {span}
        </p>
        <p className="mt-0.5 text-sm text-on-surface-muted">{t('sla_deadline', { deadline })}</p>
      </div>
    </div>
  )
}
