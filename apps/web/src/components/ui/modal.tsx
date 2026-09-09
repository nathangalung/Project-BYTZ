import { X } from 'lucide-react'
import { useRef } from 'react'
import { useDialog } from './use-dialog'

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useDialog(open, onClose)

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-lg animate-fade-in rounded-3xl border border-outline-dim/20 bg-surface-bright shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-outline-dim/20 px-6 py-4">
          <h2 className="text-lg font-bold text-brand-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-on-surface-muted hover:bg-surface-container hover:text-on-surface"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
