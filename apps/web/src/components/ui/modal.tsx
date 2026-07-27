import { X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

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
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // aria-modal promises focus stays inside; Tab has to be trapped for that.
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', handleKeyDown)
      const panel = panelRef.current
      const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE)
      ;(firstFocusable ?? panel)?.focus()
      return () => {
        document.body.style.overflow = ''
        document.removeEventListener('keydown', handleKeyDown)
        previousFocusRef.current?.focus()
      }
    }
  }, [open, handleKeyDown])

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
          <h2 className="text-lg font-bold text-primary-600">{title}</h2>
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
