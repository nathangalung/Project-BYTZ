import { Activity, Calendar, CheckCircle2, Clock, TrendingUp, Users, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectMilestones } from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

export function OverviewTab({
  project,
  projectId,
}: {
  project: {
    description: string
    budgetMin: number
    budgetMax: number
    estimatedTimelineDays: number
    teamSize: number
    finalPrice: number | null
    createdAt: string
    updatedAt: string
  }
  projectId: string
}) {
  const { t } = useTranslation('project')
  const { data: milestones = [] } = useProjectMilestones(projectId)

  const approvedCount = milestones.filter((m) => m.status === 'approved').length
  const totalCount = milestones.length
  const progressPercent = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0
  const elapsedDays = Math.floor(
    (Date.now() - new Date(project.createdAt).getTime()) / (1000 * 60 * 60 * 24),
  )
  const daysRemaining = Math.max(0, project.estimatedTimelineDays - elapsedDays)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-xl bg-surface-bright p-6 border border-outline-dim/20">
          <h3 className="mb-3 text-sm font-semibold text-primary-600">{t('description')}</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface-muted">
            {project.description}
          </p>
        </div>

        {/* Progress summary */}
        <div className="rounded-xl bg-surface-bright p-6 border border-outline-dim/20">
          <h3 className="mb-4 text-sm font-semibold text-primary-600 flex items-center gap-2">
            <Activity className="h-4 w-4 text-success-600" />
            {t('overview')}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <TrendingUp className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
              <p className="text-xs text-on-surface-muted">{t('overall_progress')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">{progressPercent}%</p>
            </div>
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
              <p className="text-xs text-on-surface-muted">{t('milestones')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">
                {approvedCount}/{totalCount}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <Clock className="mx-auto mb-1.5 h-5 w-5 text-primary-600" />
              <p className="text-xs text-on-surface-muted">{t('days_remaining')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">{daysRemaining}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
          <h3 className="mb-4 text-sm font-semibold text-primary-600">
            {t('budget')} & {t('timeline')}
          </h3>
          <div className="space-y-3">
            <InfoRow
              icon={<Wallet className="h-4 w-4 text-on-surface-muted" />}
              label={t('budget')}
              value={`${formatCurrency(project.budgetMin)} - ${formatCurrency(project.budgetMax)}`}
            />
            <InfoRow
              icon={<Clock className="h-4 w-4 text-on-surface-muted" />}
              label={t('estimated_timeline')}
              value={`${project.estimatedTimelineDays} ${t('days')}`}
            />
            <InfoRow
              icon={<Users className="h-4 w-4 text-on-surface-muted" />}
              label={t('team_size')}
              value={String(project.teamSize)}
            />
            {project.finalPrice && (
              <InfoRow
                icon={<Wallet className="h-4 w-4 text-success-600" />}
                label={t('final_price')}
                value={formatCurrency(project.finalPrice)}
                highlight
              />
            )}
          </div>
        </div>

        <div className="rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
          <h3 className="mb-4 text-sm font-semibold text-primary-600">{t('key_dates')}</h3>
          <div className="space-y-3">
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-on-surface-muted" />}
              label={t('created_at')}
              value={formatDate(project.createdAt)}
            />
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-on-surface-muted" />}
              label={t('updated_at')}
              value={formatDate(project.updatedAt)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function InfoRow({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-xs text-on-surface-muted">{label}</span>
      <span
        className={cn(
          'ml-auto text-sm font-medium',
          highlight ? 'text-success-600' : 'text-primary-600',
        )}
      >
        {value}
      </span>
    </div>
  )
}
