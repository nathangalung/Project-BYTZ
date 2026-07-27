import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

type SlideOverProps = {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  closeLabel: string
  children: React.ReactNode
  footer?: React.ReactNode
  widthClassName?: string
}

export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  icon,
  closeLabel,
  children,
  footer,
  widthClassName = 'max-w-xl',
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)

  // Callers pass inline arrows, so the listener effect must not depend on them.
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-primary-900/60 backdrop-blur-sm"
        onClick={onClose}
        tabIndex={-1}
        aria-label={closeLabel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-primary-700 shadow-2xl focus:outline-none',
          widthClassName,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-primary-600/50 px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icon}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-warning-500">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-neutral-300">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-300 hover:bg-primary-600 hover:text-neutral-200"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {footer && <div className="border-t border-primary-600/50 px-6 py-4">{footer}</div>}
      </div>
    </>
  )
}
