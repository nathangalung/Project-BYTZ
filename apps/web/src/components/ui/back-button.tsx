import { Link, type LinkProps, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * One step back out of a drill-in.
 *
 * Every authenticated detail, sub-tab and nested page is reached from a list or
 * an overview, and until now most of them ended there: the only way out was the
 * sidebar, which restarts at a hub rather than returning one level. This is the
 * single control for that, so the affordance sits in the same place, reads the
 * same way and carries the same icon everywhere.
 *
 * `to` names the parent explicitly and is preferred, because a link survives a
 * reload and a pasted address, where history does not. Pages with no single
 * parent - notifications and phone verification are reachable from anywhere -
 * omit it and step back through history instead.
 */
type BackButtonProps = {
  /** Parent route. Omitted only when the page has no single parent. */
  to?: LinkProps['to']
  params?: LinkProps['params']
  /** Overrides the generic "Kembali" when the parent deserves a name. */
  label?: string
  className?: string
}

const STYLE =
  'mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted transition-colors hover:text-brand-text'

export function BackButton({ to, params, label, className }: BackButtonProps) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const text = label ?? t('back')

  if (to === undefined) {
    return (
      <button
        type="button"
        aria-label={text}
        onClick={() => router.history.back()}
        className={cn(STYLE, className)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {text}
      </button>
    )
  }

  return (
    <Link to={to} params={params} aria-label={text} className={cn(STYLE, className)}>
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {text}
    </Link>
  )
}
