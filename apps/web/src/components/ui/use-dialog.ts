import { useCallback, useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Nested dialogs share one lock
let scrollLocks = 0

function lockScroll(): () => void {
  scrollLocks++
  document.body.style.overflow = 'hidden'
  return () => {
    scrollLocks--
    if (scrollLocks === 0) document.body.style.overflow = ''
  }
}

/**
 * Escape, focus trap, focus return.
 *
 * aria-modal tells assistive technology the rest of the page is inert, and a
 * dialog that lets Tab walk out is claiming something it does not do. Three
 * dialogs in this app wrote this from scratch and two wrote none of it, so it
 * lives here and every dialog attaches the returned ref to its panel.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Callers pass inline arrows
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCloseRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    // Focus outside means it escaped
    if (!panel.contains(active)) {
      event.preventDefault()
      first.focus()
      return
    }
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const releaseScroll = lockScroll()
    document.addEventListener('keydown', handleKeyDown)
    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(firstFocusable ?? panel)?.focus()
    return () => {
      releaseScroll()
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open, handleKeyDown])

  return panelRef
}
