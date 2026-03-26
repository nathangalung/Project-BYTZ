import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Database,
  FolderOpen,
  Loader2,
  Palette,
  Search,
  Smartphone,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNotifications } from '@/hooks/use-notifications'
import {
  useApplyToProject,
  useAvailableProjects,
  useTalentActiveProjects,
  useTalentApplications,
  useTalentProfile,
} from '@/hooks/use-talent'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/talent/')({
  component: TalentDashboardPage,
})

type AvailableProject = {
  id: string
  title: string
  category: string
  budgetMin: number
  budgetMax: number
  skills: string[]
  createdAt: string
  estimatedTimelineDays: number
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  web_app: <Code className="h-4 w-4" />,
  mobile_app: <Smartphone className="h-4 w-4" />,
  ui_ux_design: <Palette className="h-4 w-4" />,
  data_ai: <Database className="h-4 w-4" />,
  other: <Code className="h-4 w-4" />,
}

const CATEGORY_CONFIG: Record<string, { bg: string; text: string; iconBg: string }> = {
  web_app: {
    bg: 'bg-info-500/10',
    text: 'text-info-500',
    iconBg: 'bg-info-500/20',
  },
  mobile_app: {
    bg: 'bg-primary-500/10',
    text: 'text-success-500',
    iconBg: 'bg-success-500/20',
  },
  ui_ux_design: {
    bg: 'bg-accent-coral-500/15',
    text: 'text-accent-coral-500',
    iconBg: 'bg-accent-coral-500/20',
  },
  data_ai: {
    bg: 'bg-accent-cream-500/20',
    text: 'text-primary-600',
    iconBg: 'bg-warning-500/20',
  },
  other: {
    bg: 'bg-neutral-500/15',
    text: 'text-on-surface-muted',
    iconBg: 'bg-neutral-500/20',
  },
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `Rp ${(amount / 1000000).toFixed(0)}jt`
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

function TalentDashboardPage() {
  const { t } = useTranslation('talent')
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const {
    data: profile,
    isError: profileError,
    isLoading: profileLoading,
  } = useTalentProfile(user?.id ?? '')

  // DB verification: if API returns 404, redirect to register and clear localStorage cache
  useEffect(() => {
    if (!user?.id || profileLoading) return
    if (profileError) {
      localStorage.removeItem('kerjacus-profile-complete')
      navigate({ to: '/talent/register' })
      return
    }
    if (profile) {
      localStorage.setItem('kerjacus-profile-complete', user.id)
    }
  }, [user?.id, profile, profileError, profileLoading, navigate])
  const { data: availableData, isLoading: isLoadingProjects } = useAvailableProjects()
  const { data: activeProjects, isLoading: isLoadingActive } = useTalentActiveProjects(
    profile?.id ?? '',
  )
  const applyMutation = useApplyToProject()
  const { data: notificationsData } = useNotifications(1)
  const recentNotifications = (notificationsData?.items ?? []).slice(0, 3)
  const { data: applicationsRaw } = useTalentApplications(profile?.id ?? '')
  const applicationsList: Array<{ projectId: string }> = (() => {
    if (!applicationsRaw) return []
    if (Array.isArray(applicationsRaw)) return applicationsRaw
    const obj = applicationsRaw as unknown as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items as Array<{ projectId: string }>
    return []
  })()
  const appliedProjectIds = new Set(applicationsList.map((a) => a.projectId))

  const availableProjects: AvailableProject[] = availableData?.items ?? []
  const activeList = activeProjects ?? []

  const handleApply = async (projectId: string) => {
    if (!profile?.id) return
    if (appliedProjectIds.has(projectId)) return
    try {
      await applyMutation.mutateAsync({
        projectId,
        talentId: profile.id,
      })
      useToastStore.getState().addToast('success', t('apply_success'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('apply_error')
      useToastStore.getState().addToast('error', msg)
    }
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary-600">{t('dashboard_title')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">{t('dashboard_subtitle')}</p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<BriefcaseBusiness className="h-5 w-5" />}
          iconColor="text-success-500"
          label={t('active_projects')}
          value={String(profile?.totalProjectsActive ?? 0)}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          iconColor="text-info-500"
          label={t('hours_logged')}
          value="--"
        />
        <StatCard
          icon={<Star className="h-5 w-5" />}
          iconColor="text-primary-600"
          label={t('rating')}
          value={profile?.averageRating != null ? profile.averageRating.toFixed(1) : '--'}
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          iconColor="text-success-500"
          label={t('completed_projects')}
          value={String(profile?.totalProjectsCompleted ?? 0)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
            <div className="flex items-center justify-between border-b border-outline-dim/20 p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-primary-600">
                <Search className="h-5 w-5 text-on-surface-muted" />
                {t('available_projects')}
              </h2>
              {availableProjects.length > 0 && (
                <span className="rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-medium text-success-500">
                  {availableProjects.length} {t('new')}
                </span>
              )}
            </div>
            {isLoadingProjects ? (
              <div className="divide-y divide-primary-500/10">
                {['project-skeleton-1', 'project-skeleton-2', 'project-skeleton-3'].map((id) => (
                  <div key={id} className="p-5">
                    <div className="h-4 w-24 animate-pulse rounded bg-surface-container" />
                    <div className="mt-2 h-5 w-3/4 animate-pulse rounded bg-surface-container" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-container" />
                    <div className="mt-3 flex gap-2">
                      <div className="h-5 w-16 animate-pulse rounded bg-surface-container" />
                      <div className="h-5 w-16 animate-pulse rounded bg-surface-container" />
                    </div>
                  </div>
                ))}
              </div>
            ) : availableProjects.length === 0 ? (
              <div className="py-12 text-center">
                <FolderOpen className="mx-auto h-10 w-10 text-on-surface-muted" />
                <p className="mt-3 text-sm text-on-surface-muted">{t('no_available')}</p>
              </div>
            ) : (
              <div className="divide-y divide-primary-500/10">
                {availableProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    t={t}
                    onApply={handleApply}
                    applying={applyMutation.isPending}
                    alreadyApplied={appliedProjectIds.has(project.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary-600">
              <Zap className="h-5 w-5 text-success-500" />
              {t('active_projects')}
            </h2>
            {isLoadingActive ? (
              <div className="space-y-4">
                {['active-skeleton-1', 'active-skeleton-2'].map((id) => (
                  <div
                    key={id}
                    className="rounded-lg border border-outline-dim/20 bg-surface-container p-4"
                  >
                    <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-container" />
                    <div className="mt-3 h-1.5 w-full animate-pulse rounded bg-surface-container" />
                  </div>
                ))}
              </div>
            ) : activeList.length > 0 ? (
              <div className="space-y-4">
                {activeList.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-lg border border-outline-dim/20 bg-surface-container p-4"
                  >
                    <h3 className="text-sm font-semibold text-on-surface">{project.title}</h3>
                    <p className="mt-1 text-xs text-on-surface-muted">{project.currentMilestone}</p>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-on-surface-muted">{t('progress')}</span>
                        <span className="font-medium text-success-500">{project.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
                        <div
                          className="h-full rounded-full bg-success-500 transition-all"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-on-surface-muted">
                      {t('deadline')}:{' '}
                      <span className="text-on-surface-muted">{formatDate(project.deadline)}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-on-surface-muted" />
                <p className="mt-2 text-sm text-on-surface-muted">{t('no_active')}</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary-600">
              <Bell className="h-5 w-5 text-accent-coral-500" />
              {t('recent_notifications')}
            </h2>
            <div className="space-y-3">
              {recentNotifications.length > 0 ? (
                recentNotifications.map((notif) => (
                  <NotificationItem
                    key={notif.id}
                    title={notif.title}
                    time={formatDate(notif.createdAt)}
                    color={
                      notif.type === 'payment'
                        ? 'text-success-500'
                        : notif.type === 'milestone_update'
                          ? 'text-info-500'
                          : 'text-accent-coral-500'
                    }
                  />
                ))
              ) : (
                <p className="text-sm text-on-surface-muted">{t('no_notifications')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  iconColor,
  label,
  value,
  trend,
  trendUp,
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  trend?: string
  trendUp?: boolean
}) {
  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-5 transition-all hover:border-neutral-700/50">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container">
          <span className={iconColor}>{icon}</span>
        </div>
        {trend && (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
              trendUp ? 'bg-primary-500/10 text-success-500' : 'bg-error-500/10 text-error-500',
            )}
          >
            <TrendingUp className={cn('h-3 w-3', !trendUp && 'rotate-180')} />
            {trend}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className="text-sm text-on-surface-muted">{label}</p>
        <p className="mt-1 text-2xl font-bold text-primary-600">{value}</p>
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  t,
  onApply,
  applying,
  alreadyApplied,
}: {
  project: AvailableProject
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
  onApply: (projectId: string) => void
  applying: boolean
  alreadyApplied: boolean
}) {
  const categoryIcon = CATEGORY_ICONS[project.category] ?? <Code className="h-4 w-4" />
  const category = CATEGORY_CONFIG[project.category] ?? CATEGORY_CONFIG.other

  return (
    <div className="p-5 transition-colors hover:bg-surface-high">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                category.bg,
                category.text,
              )}
            >
              {categoryIcon}
              {t(project.category, project.category.replace(/_/g, ' '))}
            </span>
            <span className="text-xs text-on-surface-muted">{formatDate(project.createdAt)}</span>
          </div>

          <h3 className="mt-2 text-sm font-semibold text-on-surface">{project.title}</h3>

          <div className="mt-1.5 flex items-center gap-3 text-xs text-on-surface-muted">
            <span>
              {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
            </span>
            <span className="text-on-surface-muted">|</span>
            <span>
              {project.estimatedTimelineDays} {t('days')}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(project.skills ?? []).map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-primary-500/10 px-2 py-0.5 text-xs font-medium text-success-500"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={applying || alreadyApplied}
          onClick={() => onApply(project.id)}
          className={cn(
            'mt-1 flex shrink-0 items-center gap-1 rounded-lg px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50',
            alreadyApplied
              ? 'bg-success-500/15 text-success-600 cursor-default'
              : 'bg-primary-600 text-white hover:opacity-90',
          )}
        >
          {alreadyApplied ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              {t('applied')}
            </>
          ) : applying ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('applying')}
            </>
          ) : (
            <>
              {t('apply')}
              <ChevronRight className="h-3 w-3" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function NotificationItem({ title, time, color }: { title: string; time: string; color: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-outline-dim/10 bg-surface-high p-3">
      <div
        className={cn(
          'mt-0.5 h-2 w-2 shrink-0 rounded-full',
          color === 'text-success-500' ? 'bg-success-500' : 'bg-info-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-on-surface">{title}</p>
        <p className="text-xs text-on-surface-muted">{time}</p>
      </div>
    </div>
  )
}
