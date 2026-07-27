import { cn } from '@/lib/utils'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'error'

const TONES: Record<StatusTone, string> = {
  neutral: 'bg-neutral-500/20 text-neutral-300',
  success: 'bg-success-500/20 text-success-500',
  warning: 'bg-warning-500/20 text-warning-500',
  error: 'bg-error-500/20 text-error-500',
}

const SIZES = {
  xs: 'px-2 py-0.5 text-[10px]',
  sm: 'px-2.5 py-0.5 text-xs',
} as const

type StatusBadgeProps = {
  // Required: these badges carry financial meaning, so the state must never be
  // conveyed by colour alone.
  label: string
  icon?: React.ReactNode
  tone?: StatusTone
  size?: keyof typeof SIZES
  // Domain status maps already encode an exact intensity; twMerge lets them win.
  className?: string
}

export function StatusBadge({
  label,
  icon,
  tone = 'neutral',
  size = 'sm',
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold',
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      {icon}
      {label}
    </span>
  )
}
