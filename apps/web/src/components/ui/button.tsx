import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:opacity-90 hover:shadow-lg disabled:opacity-50',
  secondary: 'bg-accent-coral-600 text-white hover:opacity-90 hover:shadow-lg disabled:opacity-50',
  outline:
    'border border-outline-dim/30 bg-surface-bright text-on-surface hover:bg-surface-container',
  ghost: 'text-on-surface-muted hover:bg-surface-container hover:text-on-surface',
  danger: 'bg-error-600 text-white hover:opacity-90',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: {
  children: React.ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
