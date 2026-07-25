export type DailyRevenuePoint = {
  date: string
  brdRevenue: number
  prdRevenue: number
  marginRevenue: number
  revisionFee: number
  totalRevenue: number
}

export type DailyAiCostPoint = {
  date: string
  costUsd: number
  requests: number
  tokens: number
}

export type AiModelUsage = {
  model: string
  requests: number
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export type AiUsageStats = {
  totalCostUsd: number
  totalRequests: number
  avgTokensPerSuccess: number
  dailyCost: DailyAiCostPoint[]
  byModel: AiModelUsage[]
}

// Backend sends YYYY-MM-DD.
export function toDayLabel(date: string): string {
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? date : `${d.getDate()}/${d.getMonth() + 1}`
}

export function buildRevenueTrendSeries(
  daily: DailyRevenuePoint[] | undefined,
): { date: string; revenue: number }[] {
  if (!daily || daily.length === 0) return []
  return daily.map((p) => ({ date: toDayLabel(p.date), revenue: p.totalRevenue }))
}

export function buildAiCostSeries(
  daily: DailyAiCostPoint[] | undefined,
): { date: string; cost: number; requests: number }[] {
  if (!daily || daily.length === 0) return []
  return daily.map((p) => ({
    date: toDayLabel(p.date),
    cost: p.costUsd,
    requests: p.requests,
  }))
}

// Spend lands in fractions of a cent.
export function formatUsd(value: number): string {
  if (value <= 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
