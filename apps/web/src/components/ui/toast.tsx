import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'warning' | 'info'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-5 w-5 text-success-500" />,
  error: <XCircle className="h-5 w-5 text-error-500" />,
  warning: <AlertTriangle className="h-5 w-5 text-neutral-700" />,
  info: <Info className="h-5 w-5 text-info-500" />,
}

const bgColors: Record<ToastType, string> = {
  success: 'border-success-500/20 bg-success-500/5',
  error: 'border-error-500/20 bg-error-500/5',
  warning: 'border-warning-500/20 bg-warning-500/5',
  info: 'border-info-500/20 bg-info-500/5',
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
        'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
        bgColors[type],
      )}
      role="alert"
      aria-live="polite"
    >
      {icons[type]}
      <p className="flex-1 text-sm text-neutral-800">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="text-neutral-400 hover:text-neutral-600"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
