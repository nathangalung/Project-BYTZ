import { createFileRoute, Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  FolderOpen,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActivities, useProjects } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

const ACTIVITY_STYLE_MAP: Record<string, { icon: LucideIcon; iconColor: string; iconBg: string }> =
  {
    milestone_approved: {
      icon: CheckCircle2,
      iconColor: 'text-success-600',
      iconBg: 'bg-success-500/10',
    },
    milestone_submitted: {
      icon: CheckCircle2,
      iconColor: 'text-info-500',
      iconBg: 'bg-info-500/10',
    },
    milestone_rejected: {
      icon: CheckCircle2,
      iconColor: 'text-error-600',
      iconBg: 'bg-error-500/10',
    },
    talent_assigned: { icon: Users, iconColor: 'text-info-500', iconBg: 'bg-info-500/10' },
    talent_replaced: {
      icon: Users,
      iconColor: 'text-accent-coral-600',
      iconBg: 'bg-accent-coral-500/10',
    },
    talent_declined: { icon: Users, iconColor: 'text-error-600', iconBg: 'bg-error-500/10' },
    team_formed: { icon: Users, iconColor: 'text-success-600', iconBg: 'bg-success-500/10' },
    status_changed: {
      icon: FileText,
      iconColor: 'text-accent-coral-600',
      iconBg: 'bg-accent-coral-500/10',
    },
    payment_made: { icon: CreditCard, iconColor: 'text-success-600', iconBg: 'bg-success-500/10' },
    payment_released: { icon: Wallet, iconColor: 'text-success-600', iconBg: 'bg-success-500/10' },
    message_sent: { icon: MessageSquare, iconColor: 'text-info-500', iconBg: 'bg-info-500/10' },
    revision_requested: {
      icon: MessageSquare,
      iconColor: 'text-accent-coral-600',
      iconBg: 'bg-accent-coral-500/10',
    },
    file_uploaded: { icon: FileText, iconColor: 'text-primary-500', iconBg: 'bg-primary-500/10' },
    review_posted: {
      icon: CheckCircle2,
      iconColor: 'text-primary-500',
      iconBg: 'bg-primary-500/10',
    },
    dispute_opened: { icon: FileText, iconColor: 'text-error-600', iconBg: 'bg-error-500/10' },
    dispute_resolved: {
      icon: CheckCircle2,
      iconColor: 'text-success-600',
      iconBg: 'bg-success-500/10',
    },
    project_on_hold: {
      icon: Clock,
      iconColor: 'text-accent-coral-600',
      iconBg: 'bg-accent-coral-500/10',
    },
    project_resumed: { icon: Activity, iconColor: 'text-success-600', iconBg: 'bg-success-500/10' },
  }

const DEFAULT_ACTIVITY_STYLE = {
  icon: Activity,
  iconColor: 'text-neutral-500',
  iconBg: 'bg-neutral-100',
}

const STATUS_STYLES: Record<string, { key: string; bg: string; text: string }> = {
  in_progress: { key: 'status_in_progress', bg: 'bg-primary-500/10', text: 'text-primary-500' },
  matching: { key: 'status_matching', bg: 'bg-accent-coral-500/10', text: 'text-accent-coral-600' },
  brd_generated: {
    key: 'status_brd_generated',
    bg: 'bg-accent-cream-500/30',
    text: 'text-neutral-800',
  },
  review: { key: 'status_review', bg: 'bg-info-500/10', text: 'text-info-600' },
  completed: { key: 'status_completed', bg: 'bg-success-500/15', text: 'text-success-600' },
  draft: { key: 'status_draft', bg: 'bg-neutral-100', text: 'text-neutral-500' },
}

function formatRupiah(amount: number): string {
  if (amount >= 1000000) {
    return `Rp ${(amount / 1000000).toFixed(0)}jt`
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount)
}

function DashboardPage() {
  const { t } = useTranslation('common')
  const { user } = useAuthStore()
  const { data: projectsData, isLoading } = useProjects({ page: 1 })
  const { data: activitiesData, isLoading: activitiesLoading } = useActivities(5)
  const activities = activitiesData?.items ?? []
  const projects = (projectsData?.items ?? []) as Array<{
    id: string
    title: string
    status: string
    budgetMin?: number
    budgetMax?: number
    finalPrice?: number
    teamSize?: number
    progress?: number
    category?: string
  }>

  return (
    <div className="p-4 lg:p-8">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-primary-600">
          {t('welcome', 'Selamat datang')}, {user?.name ?? 'Ahmad'}
        </h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          {t('dashboard_subtitle', 'Berikut ringkasan aktivitas dan proyek Anda')}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FolderOpen className="h-5 w-5" />}
          iconColor="text-primary-500"
          iconBg="bg-primary-500/10"
          label={t('total_projects', 'Total Proyek')}
          value={String(projects.length)}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          iconColor="text-accent-coral-600"
          iconBg="bg-accent-coral-500/10"
          label={t('active_projects', 'On Going')}
          value={String(
            projects.filter((p) =>
              ['in_progress', 'matching', 'team_forming', 'matched'].includes(p.status),
            ).length,
          )}
          badge={t('badge_active', 'Aktif')}
          badgeColor="bg-accent-coral-500/10 text-accent-coral-600"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          iconColor="text-success-600"
          iconBg="bg-success-500/10"
          label={t('completed', 'Selesai')}
          value={String(projects.filter((p) => p.status === 'completed').length)}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          iconColor="text-primary-500"
          iconBg="bg-primary-500/10"
          label={t('total_spending', 'Total Spend')}
          value="--"
        />
      </div>

      {/* Main Grid */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Active Projects */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary-600">
                {t('active_projects', 'Proyek Aktif')}
              </h2>
              <Link
                to="/projects"
                className="flex items-center gap-1 text-sm font-bold text-accent-coral-600 transition-colors hover:underline"
              >
                {t('view_all', 'Lihat Semua')}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((id) => (
                  <div
                    key={id}
                    className="h-24 animate-pulse rounded-2xl border border-outline-dim/10 bg-surface-container"
                  />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="py-10 text-center">
                <FolderOpen className="mx-auto h-10 w-10 text-neutral-300" />
                <p className="mt-3 text-sm text-on-surface-muted">
                  {t('no_projects', 'Belum ada proyek')}
                </p>
                <Link
                  to="/projects/new"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 hover:shadow-lg"
                >
                  <Sparkles className="h-4 w-4" />
                  {t('create_first', 'Buat Proyek Pertama')}
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {projects.map((project) => {
                  const statusStyle = STATUS_STYLES[project.status] ?? STATUS_STYLES.draft
                  const budget = project.finalPrice ?? project.budgetMax ?? project.budgetMin ?? 0

                  return (
                    <Link
                      key={project.id}
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="block rounded-2xl border border-outline-dim/20 bg-surface-low p-5 transition-all hover:border-primary-500/30 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-bold text-on-surface">
                            {project.title}
                          </h3>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold',
                                statusStyle.bg,
                                statusStyle.text,
                              )}
                            >
                              {t(statusStyle.key)}
                            </span>
                            {budget > 0 && (
                              <span className="text-xs font-medium text-on-surface-muted">
                                {formatRupiah(budget)}
                              </span>
                            )}
                            {(project.teamSize ?? 0) > 0 && (
                              <span className="flex items-center gap-1 text-xs text-on-surface-muted">
                                <Users className="h-3 w-3" />
                                {project.teamSize} {t('talent_count')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {(project.progress ?? 0) > 0 && (
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs text-on-surface-muted">
                              {t('progress', 'Progress')}
                            </span>
                            <span className="text-xs font-bold text-primary-500">
                              {project.progress}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
                            <div
                              className="h-full rounded-full bg-primary-500 transition-all"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="space-y-4">
            <h3 className="font-bold text-primary-600">{t('quick_actions', 'Aksi Cepat')}</h3>
            <Link
              to="/projects/new"
              className="flex w-full items-center gap-4 rounded-2xl bg-primary-600 p-5 text-left text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold">{t('quick_action_submit')}</p>
                <p className="mt-0.5 text-xs opacity-70">{t('quick_action_submit_desc')}</p>
              </div>
            </Link>
          </div>

          {/* Activity Feed */}
          <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-5 shadow-sm">
            <h2 className="mb-5 text-lg font-bold text-primary-600">
              {t('recent_activity', 'Aktivitas Terbaru')}
            </h2>
            {activitiesLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="h-8 w-8 animate-pulse rounded-xl bg-surface-container" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-surface-container" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="py-6 text-center">
                <Activity className="mx-auto h-8 w-8 text-neutral-300" />
                <p className="mt-2 text-sm text-on-surface-muted">
                  {t('no_activities', 'Belum ada aktivitas')}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {activities.map((activity) => {
                  const style = ACTIVITY_STYLE_MAP[activity.type] ?? DEFAULT_ACTIVITY_STYLE
                  const Icon = style.icon
                  const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
                    addSuffix: true,
                    locale: idLocale,
                  })

                  return (
                    <div key={activity.id} className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                          style.iconBg,
                        )}
                      >
                        <Icon className={cn('h-4 w-4', style.iconColor)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-on-surface">{activity.title}</p>
                        <p className="truncate text-xs text-on-surface-muted">
                          {activity.projectTitle ?? ''}
                        </p>
                        <p className="text-xs text-outline">{timeAgo}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  badge,
  badgeColor,
  trend,
  trendUp,
}: {
  icon: React.ReactNode
  iconColor: string
  iconBg: string
  label: string
  value: string
  badge?: string
  badgeColor?: string
  trend?: string
  trendUp?: boolean
}) {
  return (
    <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl', iconBg)}>
          <span className={iconColor}>{icon}</span>
        </div>
        {badge && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-bold',
              badgeColor ?? 'bg-primary-500/10 text-primary-500',
            )}
          >
            {badge}
          </span>
        )}
        {trend && (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
              trendUp ? 'bg-success-500/15 text-success-600' : 'bg-error-500/15 text-error-600',
            )}
          >
            <TrendingUp className={cn('h-3 w-3', !trendUp && 'rotate-180')} />
            {trend}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className="text-3xl font-black text-primary-600">{value}</p>
        <p className="mt-0.5 text-xs font-medium text-on-surface-muted">{label}</p>
      </div>
    </div>
  )
}
