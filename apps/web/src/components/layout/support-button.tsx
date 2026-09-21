import { LifeBuoy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSupportConversation } from '@/hooks/use-support-conversation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

/**
 * The one control that reaches a human at KerjaCUS, from anywhere.
 *
 * It sits in the authenticated top bar, which both the talent and the owner
 * shell render, so neither side has to know where support lives. The label is
 * hidden below `sm` for the same reason the language toggle is terse there -
 * the bar has four other controls and a phone has no room for a fifth caption.
 */
export function SupportButton({ className }: { className?: string }) {
  const { t } = useTranslation('common')
  const { openSupport, isOpening } = useSupportConversation()
  // An admin reaching /messages IS the support side. Offering them a thread
  // with themselves would only ever produce SUPPORT_NO_PROJECT.
  const isAdmin = useAuthStore((s) => s.user?.role as string) === 'admin'

  if (isAdmin) return null

  return (
    <button
      type="button"
      onClick={() => openSupport()}
      disabled={isOpening}
      aria-label={t('contact_support')}
      title={t('contact_support')}
      className={cn(
        'flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-medium text-on-surface-muted transition-colors hover:bg-surface-container hover:text-brand-accent disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <LifeBuoy className="h-4 w-4" />
      <span className="hidden sm:inline">{t('contact_support')}</span>
    </button>
  )
}
