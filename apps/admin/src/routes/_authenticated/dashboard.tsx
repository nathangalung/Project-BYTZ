import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  DollarSign,
  FolderOpen,
  Loader2,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRupiah } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: AdminDashboardPage,
})

type ProjectStats = Record<string, number>

type RevenueBreakdownEntry = {
  amount: number
  count: number
}

type RevenueStats = {
  totalRevenue: number
  breakdown: Record<string, RevenueBreakdownEntry>
}

type TalentStats = {
  totalTalents: number
  tierDistribution: Record<string, number>
  activeTalents: number
  utilizationRate: number
  averageRating: number
}

type DashboardData = {
  projects: ProjectStats
  revenue: RevenueStats
  talents: TalentStats
}

function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchDashboard() {
      try {
        const res = await fetch('/api/v1/admin/dashboard', {
          credentials: 'include',
        })
        if (!res.ok) {
          throw new Error(`API returned ${res.status}`)
        }
        const json = (await res.json()) as { success: boolean; data: DashboardData }
        if (!cancelled) {
          setData(json.data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchDashboard()
    return () => {
      cancelled = true
    }
  }, [])

  return { data, loading, error }
}

function AdminDashboardPage() {
  const { t } = useTranslation('admin')
  const { data, loading, error } = useDashboardData()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary-600">
        <Loader2 className="h-8 w-8 animate-spin text-warning-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary-600 p-6">
        <div className="rounded-xl border border-error-500/30 bg-neutral-600 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-error-500" />
          <p className="mt-3 text-sm text-neutral-300">
            {t('dashboard_error', 'Gagal memuat data dashboard')}
          </p>
          <p className="mt-1 text-xs text-neutral-300">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-400"
          >
            {t('retry', 'Coba Lagi')}
          </button>
        </div>
      </div>
    )
  }

  const { projects: projectStats, revenue: revenueStats, talents: talentStats } = data

  const totalProjects = Object.values(projectStats).reduce((sum, v) => sum + v, 0)
  const activeProjects = (projectStats.in_progress ?? 0) + (projectStats.review ?? 0)
  const completedProjects = projectStats.completed ?? 0
  const totalRevenue = revenueStats.totalRevenue
  const brdRevenue = revenueStats.breakdown.brd_payment?.amount ?? 0
  const prdRevenue = revenueStats.breakdown.prd_payment?.amount ?? 0
  const escrowRevenue = revenueStats.breakdown.escrow_in?.amount ?? 0

  // Funnel from project status counts
  const brdGenerated =
    (projectStats.brd_generated ?? 0) +
    (projectStats.brd_approved ?? 0) +
    (projectStats.brd_purchased ?? 0) +
    (projectStats.prd_generated ?? 0) +
    (projectStats.prd_approved ?? 0) +
    (projectStats.prd_purchased ?? 0) +
    (projectStats.matching ?? 0) +
    (projectStats.team_forming ?? 0) +
    (projectStats.matched ?? 0) +
    activeProjects +
    completedProjects
  const prdGenerated =
    (projectStats.prd_generated ?? 0) +
    (projectStats.prd_approved ?? 0) +
    (projectStats.prd_purchased ?? 0) +
    (projectStats.matching ?? 0) +
    (projectStats.team_forming ?? 0) +
    (projectStats.matched ?? 0) +
    activeProjects +
    completedProjects
  const inProgress = activeProjects

  const funnelMax = Math.max(brdGenerated, 1)
  const funnelStages = [
    {
      label: t('funnel_brd', 'BRD Generated'),
      count: brdGenerated,
      pct: Math.round((brdGenerated / funnelMax) * 100),
    },
    {
      label: t('funnel_prd', 'PRD Generated'),
      count: prdGenerated,
      pct: Math.round((prdGenerated / funnelMax) * 100),
    },
    {
      label: t('funnel_in_progress', 'In Progress'),
      count: inProgress,
      pct: Math.round((inProgress / funnelMax) * 100),
    },
    {
      label: t('funnel_completed', 'Completed'),
      count: completedProjects,
      pct: Math.round((completedProjects / funnelMax) * 100),
    },
  ]

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">
          {t('dashboard', 'Admin Dashboard')}
        </h1>
        <p className="mt-1 text-sm text-neutral-300">{t('overview', 'Overview platform BYTZ')}</p>
      </div>

      {/* Key metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          icon={<FolderOpen className="h-5 w-5 text-success-500" />}
          label={t('total_projects', 'Total Proyek')}
          value={String(totalProjects)}
          sub={t('active_count', '{{count}} aktif', { count: activeProjects })}
        />
        <MetricCard
          icon={<DollarSign className="h-5 w-5 text-success-500" />}
          label={t('revenue', 'Revenue')}
          value={formatRupiah(totalRevenue)}
          sub={t('total_revenue_label', 'Total revenue keseluruhan')}
          trend={
            totalRevenue > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-success-500">
                <ArrowUpRight className="h-3 w-3" />
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-error-500">
                <ArrowDownRight className="h-3 w-3" />
              </span>
            )
          }
        />
        <MetricCard
          icon={<Users className="h-5 w-5 text-warning-500" />}
          label={t('workers', 'Talents')}
          value={String(talentStats.totalTalents)}
          sub={t('active_count', '{{count}} aktif', {
            count: talentStats.activeTalents,
          })}
        />
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5 text-error-500" />}
          label={t('dispute_rate', 'Dispute Rate')}
          value={`${projectStats.disputed ?? 0}`}
          sub={t('disputed_projects', 'proyek dalam dispute')}
        />
        <MetricCard
          icon={<BarChart3 className="h-5 w-5 text-success-500" />}
          label={t('utilization_rate', 'Utilization Rate')}
          value={`${(talentStats.utilizationRate * 100).toFixed(0)}%`}
          sub={t('talent_utilization', 'talent sedang aktif')}
        />
        <MetricCard
          icon={<Clock className="h-5 w-5 text-warning-500" />}
          label={t('avg_rating_label', 'Avg Rating')}
          value={`${talentStats.averageRating.toFixed(1)}/5`}
          sub={t('completed_count', '{{count}} proyek selesai', {
            count: completedProjects,
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
                <span className="text-sm font-medium text-neutral-300">{stage.label}</span>
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

      {/* Revenue breakdown + tier distribution */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Revenue breakdown */}
        <div className="rounded-xl border border-neutral-600/30 bg-primary-700 p-6">
          <h2 className="text-lg font-semibold text-warning-500">
            {t('revenue_trend', 'Revenue Trend')}
          </h2>
          <div className="mt-4 flex h-48 items-center justify-center rounded-lg border border-dashed border-neutral-600/50">
            <div className="text-center">
              <TrendingUp className="mx-auto h-10 w-10 text-neutral-600" />
              <p className="mt-2 text-sm text-neutral-300">
                {t('chart_placeholder', 'Chart akan tampil di sini')}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-primary-800 p-3 text-center">
              <p className="text-xs text-neutral-300">BRD</p>
              <p className="mt-1 text-sm font-bold text-warning-500">{formatRupiah(brdRevenue)}</p>
            </div>
            <div className="rounded-lg bg-primary-800 p-3 text-center">
              <p className="text-xs text-neutral-300">PRD</p>
              <p className="mt-1 text-sm font-bold text-warning-500">{formatRupiah(prdRevenue)}</p>
            </div>
            <div className="rounded-lg bg-primary-800 p-3 text-center">
              <p className="text-xs text-neutral-300">{t('escrow', 'Escrow')}</p>
              <p className="mt-1 text-sm font-bold text-warning-500">
                {formatRupiah(escrowRevenue)}
              </p>
            </div>
          </div>
        </div>

        {/* Tier distribution */}
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <h2 className="text-lg font-semibold text-warning-500">
            {t('tier_distribution', 'Talent Tier Distribution')}
          </h2>
          <div className="mt-4 space-y-4">
            {Object.entries(talentStats.tierDistribution).map(([tier, count]) => {
              const pct =
                talentStats.totalTalents > 0
                  ? Math.round((count / talentStats.totalTalents) * 100)
                  : 0
              return (
                <div key={tier}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium capitalize text-neutral-300">{tier}</span>
                    <span className="text-sm font-bold text-warning-500">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-primary-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-warning-500/80 to-warning-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {Object.keys(talentStats.tierDistribution).length === 0 && (
              <p className="text-sm text-neutral-300">{t('no_tier_data', 'Belum ada data tier')}</p>
            )}
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
          <p className="text-sm text-neutral-300">{label}</p>
          <div className="flex items-center gap-2">
            <p className="text-xl font-bold text-warning-500">{value}</p>
            {trend}
          </div>
          <p className="truncate text-xs text-neutral-300">{sub}</p>
        </div>
      </div>
    </div>
  )
}
