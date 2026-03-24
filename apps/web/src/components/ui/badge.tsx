import { cn } from '@/lib/utils'

type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'primary'
  | 'teal'
  | 'violet'
  | 'green'
  | 'coral'
  | 'cream'

const variants: Record<BadgeVariant, string> = {
  default: 'bg-neutral-100 text-neutral-600',
  success: 'bg-success-500/15 text-success-600',
  warning: 'bg-accent-cream-500/30 text-neutral-800',
  error: 'bg-error-500/15 text-error-600',
  info: 'bg-info-500/10 text-info-600',
  primary: 'bg-primary-500/10 text-primary-600',
  teal: 'bg-primary-500/10 text-primary-600',
  violet: 'bg-accent-coral-500/15 text-accent-coral-600',
  green: 'bg-success-500/15 text-success-600',
  coral: 'bg-accent-coral-500/15 text-accent-coral-600',
  cream: 'bg-accent-cream-500/30 text-neutral-800',
}

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
