import { createFileRoute } from '@tanstack/react-router'
import {
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Database,
  FolderOpen,
  Palette,
  Search,
  Smartphone,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useApplyToProject,
  useAvailableProjects,
  useWorkerActiveProjects,
  useWorkerProfile,
} from '@/hooks/use-workers'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/worker/')({
  component: WorkerDashboardPage,
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
  other_digital: <Code className="h-4 w-4" />,
}

const CATEGORY_CONFIG: Record<string, { bg: string; text: string; iconBg: string }> = {
  web_app: {
    bg: 'bg-info-500/15',
    text: 'text-info-500',
    iconBg: 'bg-info-500/20',
  },
  mobile_app: {
    bg: 'bg-success-500/15',
    text: 'text-success-500',
    iconBg: 'bg-success-500/20',
  },
  ui_ux_design: {
    bg: 'bg-accent-coral-500/15',
    text: 'text-accent-coral-500',
    iconBg: 'bg-accent-coral-500/20',
  },
  data_ai: {
    bg: 'bg-warning-500/15',
    text: 'text-warning-500',
    iconBg: 'bg-warning-500/20',
  },
  other_digital: {
    bg: 'bg-neutral-500/15',
    text: 'text-neutral-400',
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

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateStr))
}

function WorkerDashboardPage() {
  const { t } = useTranslation('worker')
  const { user } = useAuthStore()
  const { data: profile } = useWorkerProfile(user?.id ?? '')
  const { data: availableData, isLoading: isLoadingProjects } = useAvailableProjects()
  const { data: activeProjects, isLoading: isLoadingActive } = useWorkerActiveProjects(
    profile?.id ?? '',
  )
  const applyMutation = useApplyToProject()

  const availableProjects: AvailableProject[] = availableData?.items ?? []
  const activeList = activeProjects ?? []

  const handleApply = async (projectId: string) => {
    if (!profile?.id) return
    try {
      await applyMutation.mutateAsync({
        projectId,
        workerId: profile.id,
      })
      useToastStore.getState().addToast('success', 'Lamaran berhasil dikirim!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim lamaran'
      useToastStore.getState().addToast('error', msg)
    }
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-warning-500">
          {t('dashboard_title', 'Dashboard Worker')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('dashboard_subtitle', 'Temukan proyek dan kelola pekerjaan Anda')}
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<BriefcaseBusiness className="h-5 w-5" />}
          iconColor="text-success-500"
          label={t('active_projects', 'Proyek Aktif')}
          value={String(profile?.totalProjectsActive ?? 0)}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          iconColor="text-info-500"
          label={t('hours_logged', 'Jam Minggu Ini')}
          value="--"
        />
        <StatCard
          icon={<Star className="h-5 w-5" />}
          iconColor="text-warning-500"
          label={t('rating', 'Rating')}
          value={profile?.averageRating != null ? profile.averageRating.toFixed(1) : '--'}
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          iconColor="text-success-500"
          label={t('completed_projects', 'Proyek Selesai')}
          value={String(profile?.totalProjectsCompleted ?? 0)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-neutral-700/30 bg-neutral-600">
            <div className="flex items-center justify-between border-b border-primary-500/20 p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-warning-500">
                <Search className="h-5 w-5 text-neutral-400" />
                {t('available_projects', 'Proyek Tersedia')}
              </h2>
              {availableProjects.length > 0 && (
                <span className="rounded-full bg-success-500/15 px-2.5 py-0.5 text-xs font-medium text-success-500">
                  {availableProjects.length} {t('new', 'baru')}
                </span>
              )}
            </div>
            {isLoadingProjects ? (
              <div className="divide-y divide-primary-500/10">
                {['project-skeleton-1', 'project-skeleton-2', 'project-skeleton-3'].map((id) => (
                  <div key={id} className="p-5">
                    <div className="h-4 w-24 animate-pulse rounded bg-primary-700/50" />
                    <div className="mt-2 h-5 w-3/4 animate-pulse rounded bg-primary-700/50" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-primary-700/50" />
                    <div className="mt-3 flex gap-2">
                      <div className="h-5 w-16 animate-pulse rounded bg-primary-700/50" />
                      <div className="h-5 w-16 animate-pulse rounded bg-primary-700/50" />
                    </div>
                  </div>
                ))}
              </div>
            ) : availableProjects.length === 0 ? (
              <div className="py-12 text-center">
                <FolderOpen className="mx-auto h-10 w-10 text-neutral-500" />
                <p className="mt-3 text-sm text-neutral-500">
                  {t('no_available', 'Belum ada proyek tersedia')}
                </p>
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
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-700/30 bg-neutral-600 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-warning-500">
              <Zap className="h-5 w-5 text-success-500" />
              {t('active_projects', 'Proyek Aktif')}
            </h2>
            {isLoadingActive ? (
              <div className="space-y-4">
                {['active-skeleton-1', 'active-skeleton-2'].map((id) => (
                  <div
                    key={id}
                    className="rounded-lg border border-primary-500/20 bg-primary-700/40 p-4"
                  >
                    <div className="h-4 w-3/4 animate-pulse rounded bg-primary-700/50" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-primary-700/50" />
                    <div className="mt-3 h-1.5 w-full animate-pulse rounded bg-primary-700/50" />
                  </div>
                ))}
              </div>
            ) : activeList.length > 0 ? (
              <div className="space-y-4">
                {activeList.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-lg border border-primary-500/20 bg-primary-700/40 p-4"
                  >
                    <h3 className="text-sm font-semibold text-neutral-100">{project.title}</h3>
                    <p className="mt-1 text-xs text-neutral-400">{project.currentMilestone}</p>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-neutral-500">{t('progress', 'Progress')}</span>
                        <span className="font-medium text-success-500">{project.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary-800">
                        <div
                          className="h-full rounded-full bg-success-500 transition-all"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-neutral-500">
                      {t('deadline', 'Deadline')}:{' '}
                      <span className="text-neutral-300">{formatDate(project.deadline)}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-neutral-500" />
                <p className="mt-2 text-sm text-neutral-500">
                  {t('no_active', 'Belum ada proyek aktif')}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-700/30 bg-neutral-600 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-warning-500">
              <Bell className="h-5 w-5 text-accent-coral-500" />
              {t('recent_notifications', 'Notifikasi Terbaru')}
            </h2>
            <div className="space-y-3">
              <NotificationItem
                title={t('notif_new_match', 'Proyek baru cocok dengan skill Anda')}
                time="2 jam lalu"
                color="text-success-500"
              />
              <NotificationItem
                title={t('notif_milestone_approved', 'Milestone 2 disetujui')}
                time="1 hari lalu"
                color="text-info-500"
              />
              <NotificationItem
                title={t('notif_payment', 'Pembayaran Rp 8jt diterima')}
                time="3 hari lalu"
                color="text-success-500"
              />
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
    <div className="rounded-xl border border-neutral-700/30 bg-neutral-600 p-5 transition-all hover:border-neutral-700/50">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-700/50">
          <span className={iconColor}>{icon}</span>
        </div>
        {trend && (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
              trendUp ? 'bg-success-500/15 text-success-500' : 'bg-error-500/15 text-error-500',
            )}
          >
            <TrendingUp className={cn('h-3 w-3', !trendUp && 'rotate-180')} />
            {trend}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className="text-sm text-neutral-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-warning-500">{value}</p>
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  t,
  onApply,
  applying,
}: {
  project: AvailableProject
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
  onApply: (projectId: string) => void
  applying: boolean
}) {
  const categoryIcon = CATEGORY_ICONS[project.category] ?? <Code className="h-4 w-4" />
  const category = CATEGORY_CONFIG[project.category] ?? CATEGORY_CONFIG.other_digital

  return (
    <div className="p-5 transition-colors hover:bg-primary-700/20">
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
            <span className="text-xs text-neutral-500">{formatDate(project.createdAt)}</span>
          </div>

          <h3 className="mt-2 text-sm font-semibold text-neutral-100">{project.title}</h3>

          <div className="mt-1.5 flex items-center gap-3 text-xs text-neutral-400">
            <span>
              {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
            </span>
            <span className="text-neutral-600">|</span>
            <span>
              {project.estimatedTimelineDays} {t('days', 'hari')}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(project.skills ?? []).map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-success-500/10 px-2 py-0.5 text-xs font-medium text-success-500"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={applying}
          onClick={() => onApply(project.id)}
          className="mt-1 flex shrink-0 items-center gap-1 rounded-lg bg-success-500 px-4 py-2 text-xs font-semibold text-primary-900 transition-colors hover:bg-success-600 disabled:opacity-50"
        >
          {applying ? '...' : t('apply', 'Lamar')}
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function NotificationItem({ title, time, color }: { title: string; time: string; color: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary-500/10 bg-primary-700/30 p-3">
      <div
        className={cn(
          'mt-0.5 h-2 w-2 shrink-0 rounded-full',
          color === 'text-success-500' ? 'bg-success-500' : 'bg-info-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-200">{title}</p>
        <p className="text-xs text-neutral-500">{time}</p>
      </div>
    </div>
  )
}
