import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Calendar, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { CATEGORY_CONFIG, STATUS_CONFIG } from './shared'

export function ProjectCard({
  project,
  viewMode,
}: {
  project: {
    id: string
    title: string
    category: string
    status: string
    budgetMin: number
    budgetMax: number
    createdAt: string
    teamSize?: number
    progress?: number
  }
  viewMode: 'grid' | 'list'
}) {
  const { t } = useTranslation('project')
  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.draft
  const category = CATEGORY_CONFIG[project.category] ?? CATEGORY_CONFIG.other_digital
  const statusLabel = t(status.key)
  const categoryLabel = t(category.key)

  if (viewMode === 'list') {
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="flex items-center gap-4 rounded-xl border border-outline-dim/20 bg-surface-bright p-4 transition-all hover:border-brand-accent/30 hover:bg-surface-bright/80"
      >
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-on-surface">{project.title}</h3>
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <span
              className={cn(
                'inline-flex rounded-full px-2 py-0.5 font-medium',
                category.bg,
                category.text,
              )}
            >
              {categoryLabel}
            </span>
            <span className="flex items-center gap-1 text-on-surface-muted">
              <Calendar className="h-3 w-3" />
              {formatDate(project.createdAt)}
            </span>
            {(project.teamSize ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-on-surface-muted">
                <Users className="h-3 w-3" />
                {project.teamSize}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-sm text-on-surface-muted">
          {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
        </div>
        <span
          className={cn(
            'whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
            status.bg,
            status.text,
          )}
        >
          {statusLabel}
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-on-surface-muted" />
      </Link>
    )
  }

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="group flex flex-col rounded-xl border border-outline-dim/20 bg-surface-bright p-5 transition-all hover:border-brand-accent/30 hover:bg-surface-bright/80"
    >
      <div className="mb-3 flex items-start justify-between">
        <span
          className={cn('rounded-full px-2.5 py-1 text-xs font-medium', category.bg, category.text)}
        >
          {categoryLabel}
        </span>
        <span
          className={cn('rounded-full px-2.5 py-1 text-xs font-medium', status.bg, status.text)}
        >
          {statusLabel}
        </span>
      </div>

      <h3 className="mb-1 text-sm font-semibold text-on-surface line-clamp-2 group-hover:text-brand-text transition-colors">
        {project.title}
      </h3>

      {(project.teamSize ?? 0) > 0 && (
        <div className="mb-2 flex items-center gap-1 text-xs text-on-surface-muted">
          <Users className="h-3 w-3" />
          {project.teamSize} {t('talent_count')}
        </div>
      )}

      {(project.progress ?? 0) > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-on-surface-muted">{t('progress')}</span>
            <span className="font-medium text-success-500">{project.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
            <div
              className="h-full rounded-full bg-success-500"
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto space-y-2 border-t border-outline-dim/20 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-on-surface-muted">{t('budget')}</span>
          <span className="font-medium text-on-surface">
            {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-on-surface-muted">{t('created')}</span>
          <span className="text-on-surface-muted">{formatDate(project.createdAt)}</span>
        </div>
      </div>
    </Link>
  )
}

export function ProjectListSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
  const items = Array.from({ length: 6 }, (_, i) => `skeleton-${String(i)}`)

  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-3">
        {items.map((id) => (
          <div
            key={id}
            className="h-16 animate-pulse rounded-xl border border-outline-dim/20 bg-surface-bright/50"
          />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((id) => (
        <div
          key={id}
          className="h-48 animate-pulse rounded-xl border border-outline-dim/20 bg-surface-bright/50"
        />
      ))}
    </div>
  )
}
