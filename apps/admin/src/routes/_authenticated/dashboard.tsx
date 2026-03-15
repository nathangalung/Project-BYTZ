import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle,
  Clock,
  DollarSign,
  FolderOpen,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatRupiah } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: AdminDashboardPage,
})

function AdminDashboardPage() {
  const { t } = useTranslation('admin')

  const stats = {
    totalProjects: 47,
    activeProjects: 12,
    completedProjects: 28,
    cancelledProjects: 7,
    totalRevenue: 850000000,
    revenueThisMonth: 125000000,
    revenueLastMonth: 98000000,
    totalWorkers: 156,
    activeWorkers: 89,
    totalClients: 72,
    disputeRate: 4.2,
    avgCompletionDays: 45,
    matchSuccessRate: 92,
  }

  const revenueChange =
    stats.revenueLastMonth > 0
      ? ((stats.revenueThisMonth - stats.revenueLastMonth) / stats.revenueLastMonth) * 100
      : 0
  const revenueUp = revenueChange >= 0

  const funnelStages = [
    {
      label: t('funnel_brd', 'BRD Generated'),
      count: 42,
      pct: 100,
    },
    {
      label: t('funnel_prd', 'PRD Generated'),
      count: 31,
      pct: 74,
    },
    {
      label: t('funnel_in_progress', 'In Progress'),
      count: 12,
      pct: 29,
    },
    {
      label: t('funnel_completed', 'Completed'),
      count: 28,
      pct: 67,
    },
  ]

  const recentActivities: {
    action: string
    detail: string
    time: string
    type: 'project' | 'milestone' | 'dispute' | 'worker' | 'payment'
  }[] = [
    {
      action: t('activity_project_created', 'Proyek baru dibuat'),
      detail: 'E-commerce UMKM - Client A',
      time: t('time_5m', '5 menit lalu'),
      type: 'project',
    },
    {
      action: t('activity_milestone_approved', 'Milestone di-approve'),
      detail: 'Backend API v1 - Project #23',
      time: t('time_1h', '1 jam lalu'),
      type: 'milestone',
    },
    {
      action: t('activity_dispute_opened', 'Dispute dibuka'),
      detail: 'UI tidak sesuai spec - Project #18',
      time: t('time_3h', '3 jam lalu'),
      type: 'dispute',
    },
    {
      action: t('activity_worker_registered', 'Worker terdaftar'),
      detail: 'Budi Santoso - Backend Developer',
      time: t('time_5h', '5 jam lalu'),
      type: 'worker',
    },
    {
      action: t('activity_payment_released', 'Pembayaran dicairkan'),
      detail: 'Rp 15.000.000 - Project #21',
      time: t('time_6h', '6 jam lalu'),
      type: 'payment',
    },
    {
      action: t('activity_project_created', 'Proyek baru dibuat'),
      detail: 'Mobile Fitness App - Client D',
      time: t('time_8h', '8 jam lalu'),
      type: 'project',
    },
  ]

  const activityIcons: Record<string, React.ReactNode> = {
    project: <FolderOpen className="h-4 w-4 text-success-500" />,
    milestone: <CheckCircle className="h-4 w-4 text-success-500" />,
    dispute: <AlertTriangle className="h-4 w-4 text-error-500" />,
    worker: <UserPlus className="h-4 w-4 text-warning-500" />,
    payment: <Wallet className="h-4 w-4 text-success-500" />,
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">
          {t('dashboard', 'Admin Dashboard')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('overview', 'Overview platform BYTZ')}</p>
      </div>

      {/* Key metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          icon={<FolderOpen className="h-5 w-5 text-success-500" />}
          label={t('total_projects', 'Total Proyek')}
          value="47"
          sub={t('active_count', '{{count}} aktif', {
            count: stats.activeProjects,
          })}
        />
        <MetricCard
          icon={<DollarSign className="h-5 w-5 text-success-500" />}
          label={t('revenue', 'Revenue')}
          value={formatRupiah(stats.totalRevenue)}
          sub={`${formatRupiah(stats.revenueThisMonth)} ${t('this_month', 'bulan ini')}`}
          trend={
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-medium ${revenueUp ? 'text-success-500' : 'text-error-500'}`}
            >
              {revenueUp ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(revenueChange).toFixed(1)}%
            </span>
          }
        />
        <MetricCard
          icon={<Users className="h-5 w-5 text-warning-500" />}
          label={t('workers', 'Workers')}
          value="156"
          sub={t('active_count', '{{count}} aktif', {
            count: stats.activeWorkers,
          })}
        />
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5 text-error-500" />}
          label={t('dispute_rate', 'Dispute Rate')}
          value={`${stats.disputeRate}%`}
          sub={t('avg_completion', '{{days}}d avg completion', {
            days: stats.avgCompletionDays,
          })}
        />
        <MetricCard
          icon={<BarChart3 className="h-5 w-5 text-success-500" />}
          label={t('match_success', 'Match Success Rate')}
          value={`${stats.matchSuccessRate}%`}
          sub={t('based_on_matches', 'berdasarkan data matching')}
        />
        <MetricCard
          icon={<Clock className="h-5 w-5 text-warning-500" />}
          label={t('avg_completion_label', 'Avg Completion')}
          value={`${stats.avgCompletionDays} ${t('days', 'hari')}`}
          sub={t('completed_count', '{{count}} proyek selesai', {
            count: stats.completedProjects,
          })}
        />
      </div>

      {/* Conversion funnel */}
      <div className="mt-8 rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
        <h2 className="text-lg font-semibold text-warning-500">
          {t('conversion_funnel', 'Conversion Funnel')}
        </h2>
        <div className="mt-5 space-y-4">
          {funnelStages.map((stage) => (
            <div key={stage.label}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-400">{stage.label}</span>
                <span className="text-sm font-bold text-warning-500">{stage.count}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-primary-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-success-500/80 to-success-500"
                  style={{ width: `${stage.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue chart placeholder + recent activity */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Revenue chart placeholder */}
        <div className="rounded-xl border border-neutral-600/30 bg-primary-700 p-6">
          <h2 className="text-lg font-semibold text-warning-500">
            {t('revenue_trend', 'Revenue Trend')}
          </h2>
          <div className="mt-4 flex h-48 items-center justify-center rounded-lg border border-dashed border-neutral-600/50">
            <div className="text-center">
              <TrendingUp className="mx-auto h-10 w-10 text-neutral-600" />
              <p className="mt-2 text-sm text-neutral-500">
                {t('chart_placeholder', 'Chart akan tampil di sini')}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-primary-800 p-3 text-center">
              <p className="text-xs text-neutral-500">BRD</p>
              <p className="mt-1 text-sm font-bold text-warning-500">{formatRupiah(45000000)}</p>
            </div>
            <div className="rounded-lg bg-primary-800 p-3 text-center">
              <p className="text-xs text-neutral-500">PRD</p>
              <p className="mt-1 text-sm font-bold text-warning-500">{formatRupiah(78000000)}</p>
            </div>
            <div className="rounded-lg bg-primary-800 p-3 text-center">
              <p className="text-xs text-neutral-500">{t('margin', 'Margin')}</p>
              <p className="mt-1 text-sm font-bold text-warning-500">{formatRupiah(680000000)}</p>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <h2 className="text-lg font-semibold text-warning-500">
            {t('recent_activity', 'Aktivitas Terbaru')}
          </h2>
          <div className="mt-4 divide-y divide-primary-700/50">
            {recentActivities.map((item) => (
              <div
                key={`${item.type}-${item.detail}`}
                className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-700">
                  {activityIcons[item.type]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-200">{item.action}</p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">{item.detail}</p>
                </div>
                <span className="shrink-0 text-xs text-neutral-500">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  trend?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-primary-700 p-2.5">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm text-neutral-500">{label}</p>
          <div className="flex items-center gap-2">
            <p className="text-xl font-bold text-warning-500">{value}</p>
            {trend}
          </div>
          <p className="truncate text-xs text-neutral-500">{sub}</p>
        </div>
      </div>
    </div>
  )
}
