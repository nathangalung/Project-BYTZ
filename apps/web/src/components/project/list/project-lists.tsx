import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Calendar, CheckCircle2, FolderOpen, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ProjectCard } from './project-card'
import { type ProjectItem, STATUS_CONFIG } from './shared'

export function ActiveProjectList({
  projects,
  viewMode,
  t,
}: {
  projects: ProjectItem[]
  viewMode: 'grid' | 'list'
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-12">
        <div className="mb-3 rounded-full bg-surface-container p-3">
          <FolderOpen className="h-6 w-6 text-on-surface-muted" />
        </div>
        <p className="text-sm text-on-surface-muted">{t('no_active_projects')}</p>
      </div>
    )
  }

  return (
    <div
      className={
        viewMode === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-3'
      }
    >
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} viewMode={viewMode} />
      ))}
    </div>
  )
}

export function CompletedProjectList({
  projects,
  viewMode,
  t,
}: {
  projects: ProjectItem[]
  viewMode: 'grid' | 'list'
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-12">
        <div className="mb-3 rounded-full bg-surface-container p-3">
          <CheckCircle2 className="h-6 w-6 text-on-surface-muted" />
        </div>
        <p className="text-sm text-on-surface-muted">{t('no_completed_projects')}</p>
      </div>
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-3">
        {projects.map((project) => {
          const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.completed
          return (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="flex items-center gap-4 rounded-xl border border-outline-dim/20 bg-surface-bright p-4 transition-all hover:border-primary-500/30 hover:bg-surface-bright/80"
            >
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-on-surface">{project.title}</h3>
                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-on-surface-muted">
                    <Calendar className="h-3 w-3" />
                    {formatDate(project.updatedAt ?? project.createdAt)}
                  </span>
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
                {t(status.key)}
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-on-surface-muted" />
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => {
        const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.completed
        return (
          <Link
            key={project.id}
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="group flex flex-col rounded-xl border border-outline-dim/20 bg-surface-bright p-5 transition-all hover:border-primary-500/30 hover:bg-surface-bright/80"
          >
            <div className="mb-3 flex items-start justify-between">
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  status.bg,
                  status.text,
                )}
              >
                {t(status.key)}
              </span>
            </div>

            <h3 className="mb-1 text-sm font-semibold text-on-surface line-clamp-2 transition-colors group-hover:text-primary-600">
              {project.title}
            </h3>

            <div className="mt-auto space-y-2 border-t border-outline-dim/20 pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-muted">{t('budget')}</span>
                <span className="font-medium text-on-surface">
                  {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-muted">{t('completion_date')}</span>
                <span className="text-on-surface-muted">
                  {formatDate(project.updatedAt ?? project.createdAt)}
                </span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

export function EmptyState() {
  const { t } = useTranslation('project')

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-16">
      <div className="mb-4 rounded-full bg-surface-container p-4">
        <FolderOpen className="h-8 w-8 text-on-surface-muted" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-primary-600">{t('no_projects')}</h3>
      <p className="mb-6 max-w-sm text-center text-sm text-on-surface-muted">
        {t('no_projects_description')}
      </p>
      <Link
        to="/projects/new"
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        {t('create_project')}
      </Link>
    </div>
  )
}
