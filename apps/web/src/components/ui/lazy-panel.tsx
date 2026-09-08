import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from './error-boundary'

/**
 * A Suspense boundary that can also say the chunk never arrived.
 *
 * Suspense on its own has no error path: a rejected dynamic import leaves the
 * fallback on screen with nothing to end it, which is how the Gantt tab could
 * sit on "Loading..." indefinitely. Pairing the two is the whole point, so they
 * are one component rather than something each call site has to remember.
 *
 * The recovery offered is a reload, not an automatic one. A chunk deleted by a
 * deploy cannot be fetched again under the filename the cached HTML asks for,
 * so fresh HTML is the only cure - but reloading unprompted would take a
 * running timer or an unsent message with it, and that is the owner's call.
 */
export function LazyPanel({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { t } = useTranslation('common')

  return (
    <ErrorBoundary
      fallback={
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-12 text-center">
          <p className="text-sm font-medium text-brand-text">{t('chunk_failed_title')}</p>
          <p className="mt-1 text-sm text-on-surface-muted">{t('chunk_failed_hint')}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {t('reload_page')}
          </button>
        </div>
      }
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  )
}
