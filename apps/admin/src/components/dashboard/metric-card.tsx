export function MetricCard({
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

// Small figure tiles under a chart (BRD / PRD / escrow, AI spend headlines).
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-primary-800 p-3 text-center">
      <p className="text-xs text-neutral-300">{label}</p>
      <p className="mt-1 text-sm font-bold text-warning-500">{value}</p>
    </div>
  )
}
