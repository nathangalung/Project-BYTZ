import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  FolderOpen,
  MessageSquare,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjects } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

const DUMMY_ACTIVITIES = [
  {
    id: 'act-1',
    icon: CheckCircle2,
    iconColor: 'text-success-500',
    title: 'Milestone 3 disetujui',
    project: 'Platform E-commerce UMKM',
    time: '2 jam lalu',
  },
  {
    id: 'act-2',
    icon: Users,
    iconColor: 'text-info-500',
    title: 'Worker baru di-assign',
    project: 'Platform E-commerce UMKM',
    time: '5 jam lalu',
  },
  {
    id: 'act-3',
    icon: FileText,
    iconColor: 'text-warning-500',
    title: 'BRD selesai di-generate',
    project: 'Dashboard Analytics Internal',
    time: '1 hari lalu',
  },
  {
    id: 'act-4',
    icon: CreditCard,
    iconColor: 'text-success-500',
    title: 'Pembayaran escrow berhasil',
    project: 'Mobile App Booking Lapangan',
    time: '2 hari lalu',
  },
  {
    id: 'act-5',
    icon: MessageSquare,
    iconColor: 'text-info-500',
    title: 'Pesan baru dari worker',
    project: 'Platform E-commerce UMKM',
    time: '3 hari lalu',
  },
]

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  in_progress: {
    label: 'In Progress',
    bg: 'bg-success-500/15',
    text: 'text-success-500',
  },
  matching: {
    label: 'Matching',
    bg: 'bg-warning-500/15',
    text: 'text-warning-500',
  },
  brd_generated: {
    label: 'BRD Review',
    bg: 'bg-error-500/15',
    text: 'text-error-500',
  },
  review: {
    label: 'Review',
    bg: 'bg-info-500/15',
    text: 'text-info-500',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-success-500/15',
    text: 'text-success-500',
  },
  draft: {
    label: 'Draft',
    bg: 'bg-neutral-500/15',
    text: 'text-neutral-400',
  },
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-warning-500">
          {t('welcome', 'Selamat datang')}, {user?.name ?? 'Ahmad'}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('dashboard_subtitle', 'Berikut ringkasan aktivitas dan proyek Anda')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FolderOpen className="h-5 w-5" />}
          iconColor="text-success-500"
          label={t('active_projects', 'Proyek Aktif')}
          value={String(
            projects.filter((p) =>
              ['in_progress', 'matching', 'team_forming', 'matched'].includes(p.status),
            ).length,
          )}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          iconColor="text-error-500"
          label={t('pending_actions', 'Pending Review')}
          value={String(
            projects.filter((p) => ['brd_generated', 'prd_generated', 'review'].includes(p.status))
              .length,
          )}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          iconColor="text-warning-500"
          label={t('total_spending', 'Total Pengeluaran')}
          value="--"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          iconColor="text-success-500"
          label={t('completed', 'Proyek Selesai')}
          value={String(projects.filter((p) => p.status === 'completed').length)}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-neutral-700/30 bg-neutral-600 p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-warning-500">
                {t('active_projects', 'Proyek Aktif')}
              </h2>
              <Link
                to="/projects"
                className="flex items-center gap-1 text-sm font-medium text-success-500 transition-colors hover:text-success-600"
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
                    className="h-24 animate-pulse rounded-lg border border-primary-500/20 bg-primary-700/30"
                  />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="py-10 text-center">
                <FolderOpen className="mx-auto h-10 w-10 text-neutral-500" />
                <p className="mt-3 text-sm text-neutral-500">
                  {t('no_projects', 'Belum ada proyek')}
                </p>
                <Link
                  to="/projects/new"
                  className="mt-4 inline-flex items-center gap-1 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-900 transition-colors hover:bg-success-600"
                >
                  {t('create_first', 'Buat Proyek Pertama')}
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {projects.map((project) => {
                  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.draft
                  const budget = project.finalPrice ?? project.budgetMax ?? project.budgetMin ?? 0

                  return (
                    <Link
                      key={project.id}
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="block rounded-lg border border-primary-500/20 bg-primary-700/40 p-4 transition-all hover:border-success-500/30 hover:bg-primary-700/60"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-neutral-100">
                            {project.title}
                          </h3>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                                status.bg,
                                status.text,
                              )}
                            >
                              {status.label}
                            </span>
                            {budget > 0 && (
                              <span className="text-xs text-neutral-400">
                                {formatRupiah(budget)}
                              </span>
                            )}
                            {(project.teamSize ?? 0) > 0 && (
                              <span className="flex items-center gap-1 text-xs text-neutral-400">
                                <Users className="h-3 w-3" />
                                {project.teamSize} {t('workers', 'workers')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {(project.progress ?? 0) > 0 && (
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs text-neutral-400">
                              {t('progress', 'Progress')}
                            </span>
                            <span className="text-xs font-medium text-success-500">
                              {project.progress}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary-800">
                            <div
                              className="h-full rounded-full bg-success-500 transition-all"
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

        <div>
          <div className="rounded-xl border border-neutral-700/30 bg-neutral-600 p-5">
            <h2 className="mb-5 text-lg font-semibold text-warning-500">
              {t('recent_activity', 'Aktivitas Terbaru')}
            </h2>
            <div className="space-y-4">
              {DUMMY_ACTIVITIES.map((activity) => {
                const Icon = activity.icon

                return (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-700/50">
                      <Icon className={cn('h-4 w-4', activity.iconColor)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-100">{activity.title}</p>
                      <p className="truncate text-xs text-neutral-400">{activity.project}</p>
                      <p className="text-xs text-neutral-500">{activity.time}</p>
                    </div>
                  </div>
                )
              })}
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
