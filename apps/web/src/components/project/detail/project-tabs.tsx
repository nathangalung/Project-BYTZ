import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { TAB_ICONS, TAB_LABEL_KEYS, TAB_ROUTES, TABS, type Tab } from './shared'

/**
 * The project detail tab strip, shared by the four tabbed routes (overview,
 * milestones, documents, time tracking).
 *
 * It used to live inline in the overview page, so the sibling routes had no
 * tabs at all and each showed its own "back to <project title>" link instead.
 * Opening a tab therefore replaced the strip with a back button, and the owner
 * lost the other tabs. The strip is now the same on every tab and the active
 * one is a non-link. The sibling routes pass `title` so they keep the project
 * context the back link used to carry; overview omits it because its own header
 * already prints the title above.
 */
export function ProjectTabs({
  projectId,
  active,
  title,
  className,
}: {
  projectId: string
  active: Tab
  title?: string
  className?: string
}) {
  const { t } = useTranslation('project')

  return (
    <div className={cn('mb-6', className)}>
      {title && <h1 className="mb-4 truncate text-lg font-semibold text-brand-text">{title}</h1>}
      <div className="border-b border-outline-dim/20">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) =>
            tab === active ? (
              <span
                key={tab}
                aria-current="page"
                className="inline-flex shrink-0 items-center gap-2 border-b-2 border-success-500 pb-3 text-sm font-medium text-success-600"
              >
                {TAB_ICONS[tab]}
                {t(TAB_LABEL_KEYS[tab])}
              </span>
            ) : (
              <Link
                key={tab}
                to={TAB_ROUTES[tab]}
                params={{ projectId }}
                className="inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent pb-3 text-sm font-medium text-on-surface-muted transition-colors hover:border-outline-dim/20 hover:text-brand-text/80"
              >
                {TAB_ICONS[tab]}
                {t(TAB_LABEL_KEYS[tab])}
              </Link>
            ),
          )}
        </nav>
      </div>
    </div>
  )
}
