import { cn } from '@/lib/utils'

// Panel sections inside a slide-over: the same card in every detail view.
export function DetailSection({
  title,
  icon,
  tone = 'default',
  children,
}: {
  title: string
  icon?: React.ReactNode
  tone?: 'default' | 'danger'
  children: React.ReactNode
}) {
  const danger = tone === 'danger'
  return (
    <div
      className={cn(
        'rounded-lg border bg-neutral-600 p-4',
        danger ? 'border-error-500/30' : 'border-neutral-600/30',
      )}
    >
      <h3
        className={cn(
          'mb-3 flex items-center gap-2 text-sm font-semibold',
          danger ? 'text-error-500' : 'text-warning-500',
        )}
      >
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

export function DetailField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-xs text-neutral-300">{label}</p>
      <div className="mt-1 text-sm text-neutral-300">{children}</div>
    </div>
  )
}
