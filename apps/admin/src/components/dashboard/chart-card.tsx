import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ChartCard({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-neutral-600/30 bg-primary-700 p-6', className)}>
      <h2 className="mb-4 text-lg font-semibold text-warning-500">{title}</h2>
      {children}
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="flex h-[300px] items-center justify-center rounded-lg bg-primary-800/40">
      <Loader2 className="h-6 w-6 animate-spin text-warning-500/60" />
    </div>
  )
}

// Charts that resolve to nothing must read as empty, not broken.
export function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[300px] items-center justify-center text-sm text-neutral-300">
      {message}
    </div>
  )
}
