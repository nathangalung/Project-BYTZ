import { useQuery } from '@tanstack/react-query'
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
  Users,
} from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartCard, ChartEmpty, ChartSkeleton } from '@/components/dashboard/chart-card'
import { MetricCard, StatTile } from '@/components/dashboard/metric-card'
import { PageHeader } from '@/components/ui/page-header'
import { apiGet } from '@/lib/api'
import type { AiUsageStats, DailyRevenuePoint } from '@/lib/dashboard-series'
import {
  buildAiCostSeries,
  buildRevenueTrendSeries,
  compactNumber,
  formatUsd,
} from '@/lib/dashboard-series'
import { formatCurrencyCompact } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: AdminDashboardPage,
})

// One lazy chunk for all five charts: recharts should not block the metrics.
const chartsModule = () => import('@/components/dashboard/charts')
const RevenueTrendChart = lazy(() => chartsModule().then((m) => ({ default: m.RevenueTrendChart })))
const ConversionFunnelChart = lazy(() =>
  chartsModule().then((m) => ({ default: m.ConversionFunnelChart })),
)
const TierDistributionChart = lazy(() =>
  chartsModule().then((m) => ({ default: m.TierDistributionChart })),
)
const StatusDistributionChart = lazy(() =>
  chartsModule().then((m) => ({ default: m.StatusDistributionChart })),
)
const AiCostChart = lazy(() => chartsModule().then((m) => ({ default: m.AiCostChart })))

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
  dailyRevenue?: DailyRevenuePoint[]
  talents: TalentStats
  aiUsage?: AiUsageStats
}

function useDashboardData() {
  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery<DashboardData>({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiGet<DashboardData>('/api/v1/admin/dashboard'),
    staleTime: 5 * 60 * 1000,
  })
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to load dashboard'
    : null
  return { data: data ?? null, loading, error }
}

function AdminDashboardPage() {
  const { t } = useTranslation('admin')
  const { data, loading, error } = useDashboardData()

  // Always compute hooks before any early return
  const revenueTrendData = useMemo(
    () => buildRevenueTrendSeries(data?.dailyRevenue),
    [data?.dailyRevenue],
  )

  const aiCostSeries = useMemo(
    () => buildAiCostSeries(data?.aiUsage?.dailyCost),
    [data?.aiUsage?.dailyCost],
  )

  const tierData = useMemo(() => {
    if (!data) return []
    return Object.entries(data.talents.tierDistribution).map(([tier, count]) => ({
      tier: tier.charAt(0).toUpperCase() + tier.slice(1),
      tierKey: tier,
      count,
    }))
  }, [data])

  // Status keys for the conversion funnel — ordered by lifecycle stage
  const funnelOrder = useMemo(
    () => [
      'draft',
      'scoping',
      'brd_generated',
      'prd_generated',
      'matching',
      'in_progress',
      'completed',
    ],
    [],
  )

  const funnelData = useMemo(() => {
    if (!data) return []
    return funnelOrder.map((status) => ({
      status,
      label: t(`status_${status}`, status),
      count: data.projects[status] ?? 0,
    }))
  }, [data, funnelOrder, t])

  const statusPieData = useMemo(() => {
    if (!data) return []
    return Object.entries(data.projects)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        name: t(`status_${status}`, status),
        statusKey: status,
        value: count,
      }))
  }, [data, t])

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
  const aiUsage = data.aiUsage

  const totalProjects = Object.values(projectStats).reduce((sum, v) => sum + v, 0)
  const activeProjects = (projectStats.in_progress ?? 0) + (projectStats.review ?? 0)
  const completedProjects = projectStats.completed ?? 0
  const totalRevenue = revenueStats.totalRevenue
  const brdRevenue = revenueStats.breakdown.brd_payment?.amount ?? 0
  const prdRevenue = revenueStats.breakdown.prd_payment?.amount ?? 0
  const escrowRevenue = revenueStats.breakdown.escrow_in?.amount ?? 0

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <PageHeader
        title={t('dashboard', 'Admin Dashboard')}
        description={t('overview', 'Overview platform BYTZ')}
      />

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
          value={formatCurrencyCompact(totalRevenue)}
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
          label={t('talents', 'Talents')}
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

      {/* Row 1: Revenue Trend + Conversion Funnel */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard title={t('revenue_trend', 'Revenue Trend (Last 30 Days)')}>
          {loading ? (
            <ChartSkeleton />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <RevenueTrendChart data={revenueTrendData} />
            </Suspense>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatTile label="BRD" value={formatCurrencyCompact(brdRevenue)} />
            <StatTile label="PRD" value={formatCurrencyCompact(prdRevenue)} />
            <StatTile label={t('escrow', 'Escrow')} value={formatCurrencyCompact(escrowRevenue)} />
          </div>
        </ChartCard>

        <ChartCard title={t('conversion_funnel', 'Conversion Funnel')}>
          {funnelData.length === 0 ? (
            <ChartEmpty message={t('chart_no_data', 'No data available')} />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <ConversionFunnelChart data={funnelData} />
            </Suspense>
          )}
        </ChartCard>
      </div>

      {/* Row 2: Tier Distribution + Status Distribution */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title={t('tier_distribution', 'Talent Tier Distribution')}>
          {tierData.length === 0 ? (
            <ChartEmpty message={t('no_tier_data', 'Belum ada data tier')} />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <TierDistributionChart data={tierData} />
            </Suspense>
          )}
        </ChartCard>

        <ChartCard title={t('status_distribution', 'Project Status Distribution')}>
          {statusPieData.length === 0 ? (
            <ChartEmpty message={t('chart_no_data', 'No data available')} />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <StatusDistributionChart data={statusPieData} />
            </Suspense>
          )}
        </ChartCard>
      </div>

      {/* Row 3: AI spend trend + per-model breakdown */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title={t('ai_cost_trend', 'AI Cost (Last 30 Days)')}>
          {aiCostSeries.length === 0 ? (
            <ChartEmpty message={t('chart_no_data', 'No data available')} />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <AiCostChart data={aiCostSeries} />
            </Suspense>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatTile
              label={t('ai_total_cost', 'Total Biaya')}
              value={formatUsd(aiUsage?.totalCostUsd ?? 0)}
            />
            <StatTile
              label={t('ai_requests', 'Request')}
              value={compactNumber.format(aiUsage?.totalRequests ?? 0)}
            />
            <StatTile
              label={t('ai_avg_tokens', 'Rata-rata Token')}
              value={compactNumber.format(aiUsage?.avgTokensPerSuccess ?? 0)}
            />
          </div>
        </ChartCard>

        <ChartCard title={t('ai_cost_per_model', 'Biaya per Model')}>
          {!aiUsage || aiUsage.byModel.length === 0 ? (
            <ChartEmpty message={t('chart_no_data', 'No data available')} />
          ) : (
            <div className="max-h-[300px] overflow-x-auto overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-primary-700 text-xs text-neutral-300">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t('ai_model', 'Model')}</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      {t('ai_requests', 'Request')}
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      {t('ai_tokens', 'Token (in/out)')}
                    </th>
                    <th className="py-2 text-right font-medium">{t('ai_cost', 'Biaya AI')}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.byModel.map((m) => (
                    <tr key={m.model} className="border-t border-neutral-600/30">
                      <td className="py-2 pr-3 font-mono text-xs text-neutral-100">{m.model}</td>
                      <td className="py-2 pr-3 text-right text-neutral-100">
                        {compactNumber.format(m.requests)}
                      </td>
                      <td className="py-2 pr-3 text-right text-neutral-300">
                        {compactNumber.format(m.promptTokens)} /{' '}
                        {compactNumber.format(m.completionTokens)}
                      </td>
                      <td className="py-2 text-right font-medium text-warning-500">
                        {formatUsd(m.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-neutral-300">
            {t('ai_cost_note', 'Biaya dalam USD, dihitung dari tarif token model.')}
          </p>
        </ChartCard>
      </div>
    </div>
  )
}
