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
  default: 'bg-surface-container text-on-surface-muted',
  success: 'bg-success-500/15 text-success-600',
  warning: 'bg-accent-cream-500/30 dark:bg-accent-cream-500/10 text-brand-text',
  error: 'bg-error-500/15 text-error-600',
  info: 'bg-brand-accent/10 text-on-surface-muted',
  primary: 'bg-brand-accent/10 text-brand-text',
  teal: 'bg-brand-accent/10 text-brand-text',
  violet: 'bg-accent-coral-500/15 text-accent-coral-600',
  green: 'bg-success-500/15 text-success-600',
  coral: 'bg-accent-coral-500/15 text-accent-coral-600',
  cream: 'bg-accent-cream-500/30 dark:bg-accent-cream-500/10 text-brand-text',
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
