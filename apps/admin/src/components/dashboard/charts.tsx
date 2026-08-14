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
import { formatUsd } from '@/lib/dashboard-series'
import { formatCurrencyCompact } from '@/lib/utils'

/**
 * Every recharts-bearing block of the dashboard lives here so the route can
 * defer the library to a single lazy chunk and paint its metrics first.
 */

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

// Tailwind tokens for Recharts axis/grid (inline RGB equivalents of brand palette)
const axisStroke = CHART_COLORS.slateLight
const gridStroke = '#2e4256'
const tooltipBg = CHART_COLORS.primaryDark
const tooltipBorder = CHART_COLORS.slate

const TOOLTIP_STYLE = {
  backgroundColor: tooltipBg,
  border: `1px solid ${tooltipBorder}`,
  borderRadius: 8,
  color: '#fff',
} as const

export type RevenueTrendPoint = { date: string; revenue: number }
export type AiCostPoint = { date: string; cost: number; requests: number }
export type FunnelPoint = { status: string; label: string; count: number }
export type TierPoint = { tier: string; tierKey: string; count: number }
export type StatusPiePoint = { name: string; statusKey: string; value: number }

export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  const { t } = useTranslation('admin')

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 8 }}>
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
          tickFormatter={(v: number) => formatCurrencyCompact(v)}
          width={70}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: CHART_COLORS.cream }}
          formatter={(value) => [formatCurrencyCompact(Number(value)), t('revenue', 'Revenue')]}
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
  )
}

export function ConversionFunnelChart({ data }: { data: FunnelPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 16, bottom: 5, left: 20 }}>
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
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: `${CHART_COLORS.slate}33` }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? CHART_COLORS.green} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TierDistributionChart({ data }: { data: TierPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 8 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="tier" stroke={axisStroke} tick={{ fill: axisStroke, fontSize: 12 }} />
        <YAxis
          stroke={axisStroke}
          tick={{ fill: axisStroke, fontSize: 11 }}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: `${CHART_COLORS.slate}33` }} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.tierKey} fill={TIER_COLORS[entry.tierKey] ?? CHART_COLORS.green} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatusDistributionChart({ data }: { data: StatusPiePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
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
          {data.map((entry) => (
            <Cell
              key={entry.statusKey}
              fill={STATUS_COLORS[entry.statusKey] ?? CHART_COLORS.green}
            />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend
          verticalAlign="bottom"
          height={36}
          wrapperStyle={{ fontSize: 11, color: axisStroke }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function AiCostChart({ data }: { data: AiCostPoint[] }) {
  const { t } = useTranslation('admin')

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 8 }}>
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
          tickFormatter={(v: number) => formatUsd(v)}
          width={70}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: CHART_COLORS.cream }}
          formatter={(value, name) =>
            name === 'cost'
              ? [formatUsd(Number(value)), t('ai_cost', 'Biaya AI')]
              : [String(value), t('ai_requests', 'Request')]
          }
        />
        <Line
          type="monotone"
          dataKey="cost"
          stroke={CHART_COLORS.green}
          strokeWidth={2}
          dot={{ fill: CHART_COLORS.green, r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
