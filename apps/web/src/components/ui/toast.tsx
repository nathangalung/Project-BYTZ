import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'warning' | 'info'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-5 w-5 text-success-600" />,
  error: <XCircle className="h-5 w-5 text-error-600" />,
  warning: <AlertTriangle className="h-5 w-5 text-on-surface-muted" />,
  info: <Info className="h-5 w-5 text-on-surface-muted" />,
}

const bgColors: Record<ToastType, string> = {
  success: 'border-success-500/20 bg-success-500/10',
  error: 'border-error-500/20 bg-error-500/10',
  warning: 'border-accent-cream-600/30 bg-accent-cream-500/20',
  info: 'border-outline-dim/20 bg-primary-600/10',
}

export function Toast({
  type,
  message,
  onClose,
  duration = 5000,
}: {
  type: ToastType
  message: string
  onClose: () => void
  duration?: number
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg animate-fade-in',
        bgColors[type],
      )}
      role="alert"
      aria-live="polite"
    >
      {icons[type]}
      <p className="flex-1 text-sm font-medium text-on-surface">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="text-on-surface-muted hover:text-on-surface"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
