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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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

type DailyRevenuePoint = {
  date: string
  brdRevenue: number
  prdRevenue: number
  marginRevenue: number
  revisionFee: number
  totalRevenue: number
}

type DashboardData = {
  projects: ProjectStats
  revenue: RevenueStats
  dailyRevenue?: DailyRevenuePoint[]
  talents: TalentStats
}

// Brand color palette for charts
const CHART_COLORS = {
  primary: '#1d4a54',
  primaryDark: '#152e34',
  primaryLight: '#467a87',
  coral: '#e59a91',
  coralDark: '#d47367',
  cream: '#f6f3ab',
  creamDark: '#e8e47a',
  green: '#9fc26e',
  greenDark: '#7fa84e',
  slate: '#3b526a',
  slateLight: '#5e677d',
  neutral: '#8891a0',
} as const

// Tier-specific colors
const TIER_COLORS: Record<string, string> = {
  junior: CHART_COLORS.green,
  mid: CHART_COLORS.coral,
  senior: CHART_COLORS.primary,
}

// Status-specific colors for funnel/pie
const STATUS_COLORS: Record<string, string> = {
  draft: CHART_COLORS.neutral,
  scoping: CHART_COLORS.slateLight,
  brd_generated: CHART_COLORS.slate,
  brd_approved: CHART_COLORS.slate,
  brd_purchased: CHART_COLORS.cream,
  prd_generated: CHART_COLORS.primaryLight,
  prd_approved: CHART_COLORS.primaryLight,
  prd_purchased: CHART_COLORS.cream,
  matching: CHART_COLORS.coral,
  team_forming: CHART_COLORS.coral,
  matched: CHART_COLORS.coralDark,
  in_progress: CHART_COLORS.primary,
  partially_active: CHART_COLORS.primary,
  review: CHART_COLORS.greenDark,
  completed: CHART_COLORS.green,
  cancelled: CHART_COLORS.neutral,
  disputed: CHART_COLORS.coralDark,
  on_hold: CHART_COLORS.slateLight,
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

function buildRevenueTrendSeries(
  daily: DailyRevenuePoint[] | undefined,
): { date: string; revenue: number }[] {
  if (!daily || daily.length === 0) return []
  return daily.map((p) => {
    const d = new Date(p.date)
    const label = Number.isNaN(d.getTime()) ? p.date : `${d.getDate()}/${d.getMonth() + 1}`
    return { date: label, revenue: p.totalRevenue }
  })
}

function ChartCard({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-neutral-600/30 bg-primary-700 p-6 ${className}`}>
      <h2 className="mb-4 text-lg font-semibold text-warning-500">{title}</h2>
      {children}
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="flex h-[300px] items-center justify-center rounded-lg bg-primary-800/40">
      <Loader2 className="h-6 w-6 animate-spin text-warning-500/60" />
    </div>
  )
}

function AdminDashboardPage() {
  const { t } = useTranslation('admin')
  const { data, loading, error } = useDashboardData()

  // Always compute hooks before any early return
  const revenueTrendData = useMemo(
    () => buildRevenueTrendSeries(data?.dailyRevenue),
    [data?.dailyRevenue],
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

  const totalProjects = Object.values(projectStats).reduce((sum, v) => sum + v, 0)
  const activeProjects = (projectStats.in_progress ?? 0) + (projectStats.review ?? 0)
  const completedProjects = projectStats.completed ?? 0
  const totalRevenue = revenueStats.totalRevenue
  const brdRevenue = revenueStats.breakdown.brd_payment?.amount ?? 0
  const prdRevenue = revenueStats.breakdown.prd_payment?.amount ?? 0
  const escrowRevenue = revenueStats.breakdown.escrow_in?.amount ?? 0

  // Tailwind tokens for Recharts axis/grid (inline RGB equivalents of brand palette)
  const axisStroke = CHART_COLORS.slateLight
  const gridStroke = '#2e4256'
  const tooltipBg = CHART_COLORS.primaryDark
  const tooltipBorder = CHART_COLORS.slate

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
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueTrendData} margin={{ top: 5, right: 16, bottom: 5, left: 8 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke={axisStroke}
                  tick={{ fill: axisStroke, fontSize: 11 }}
                  interval={4}
                />
                <YAxis
                  stroke={axisStroke}
                  tick={{ fill: axisStroke, fontSize: 11 }}
                  tickFormatter={(v: number) => formatRupiah(v)}
                  width={70}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: 8,
                    color: '#fff',
                  }}
                  labelStyle={{ color: CHART_COLORS.cream }}
                  formatter={(value) => [formatRupiah(Number(value)), t('revenue', 'Revenue')]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={CHART_COLORS.cream}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLORS.cream, r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
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
        </ChartCard>

        <ChartCard title={t('conversion_funnel', 'Conversion Funnel')}>
          {funnelData.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-neutral-300">
              {t('chart_no_data', 'No data available')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={funnelData}
                layout="vertical"
                margin={{ top: 5, right: 16, bottom: 5, left: 20 }}
              >
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  stroke={axisStroke}
                  tick={{ fill: axisStroke, fontSize: 11 }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke={axisStroke}
                  tick={{ fill: axisStroke, fontSize: 11 }}
                  width={110}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: 8,
                    color: '#fff',
                  }}
                  cursor={{ fill: `${CHART_COLORS.slate}33` }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {funnelData.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={STATUS_COLORS[entry.status] ?? CHART_COLORS.green}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: Tier Distribution + Status Distribution */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title={t('tier_distribution', 'Talent Tier Distribution')}>
          {tierData.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-neutral-300">
              {t('no_tier_data', 'Belum ada data tier')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tierData} margin={{ top: 5, right: 16, bottom: 5, left: 8 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="tier"
                  stroke={axisStroke}
                  tick={{ fill: axisStroke, fontSize: 12 }}
                />
                <YAxis
                  stroke={axisStroke}
                  tick={{ fill: axisStroke, fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: 8,
                    color: '#fff',
                  }}
                  cursor={{ fill: `${CHART_COLORS.slate}33` }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {tierData.map((entry) => (
                    <Cell
                      key={entry.tierKey}
                      fill={TIER_COLORS[entry.tierKey] ?? CHART_COLORS.green}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={t('status_distribution', 'Project Status Distribution')}>
          {statusPieData.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-neutral-300">
              {t('chart_no_data', 'No data available')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  innerRadius={45}
                  paddingAngle={2}
                  label={(props) => {
                    const name = (props as { name?: string }).name ?? ''
                    const value = (props as { value?: number }).value ?? 0
                    return `${name}: ${value}`
                  }}
                  labelLine={false}
                >
                  {statusPieData.map((entry) => (
                    <Cell
                      key={entry.statusKey}
                      fill={STATUS_COLORS[entry.statusKey] ?? CHART_COLORS.green}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: 8,
                    color: '#fff',
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: 11, color: axisStroke }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
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
