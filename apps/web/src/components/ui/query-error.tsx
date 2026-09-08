import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * What a section says when its own fetch failed.
 *
 * The shape this replaces is `data ?? []` followed by a length check, so a
 * request that never returned renders the same "nothing here yet" as an account
 * that genuinely has nothing. Only one of those two has anything the reader can
 * do about it, and saying which is which is the whole point.
 *
 * Both props are required. A message that names what failed is the difference
 * between this and a generic banner, and an error with no way forward is the
 * dead end the empty state already was.
 */
export function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('common')

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-error-500/30 bg-error-500/5 p-6 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-error-500" />
      <p className="mt-3 text-sm font-medium text-on-surface">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        <RefreshCw className="h-4 w-4" />
        {t('retry')}
      </button>
    </div>
  )
}
