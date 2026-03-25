import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs } from '@/components/ui/tabs'
import { useProjects } from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/projects/')({
  component: ProjectListPage,
})

const ACTIVE_STATUSES = new Set([
  'draft',
  'scoping',
  'brd_generated',
  'brd_approved',
  'prd_generated',
  'prd_approved',
  'matching',
  'team_forming',
  'matched',
  'in_progress',
  'partially_active',
  'review',
  'on_hold',
  'disputed',
])

const COMPLETED_STATUSES = new Set(['completed', 'cancelled', 'brd_purchased', 'prd_purchased'])

const STATUS_CONFIG: Record<string, { key: string; bg: string; text: string }> = {
  draft: {
    key: 'status_draft',
    bg: 'bg-neutral-500/20',
    text: 'text-on-surface-muted',
  },
  scoping: {
    key: 'status_scoping',
    bg: 'bg-info-500/10',
    text: 'text-info-500',
  },
  brd_generated: {
    key: 'status_brd_generated',
    bg: 'bg-accent-cream-500/20',
    text: 'text-primary-600',
  },
  brd_approved: {
    key: 'status_brd_approved',
    bg: 'bg-warning-500/20',
    text: 'text-primary-600',
  },
  brd_purchased: {
    key: 'status_brd_purchased',
    bg: 'bg-accent-cream-500/20',
    text: 'text-primary-600',
  },
  prd_generated: {
    key: 'status_prd_generated',
    bg: 'bg-info-500/10',
    text: 'text-info-500',
  },
  prd_approved: {
    key: 'status_prd_approved',
    bg: 'bg-info-500/10',
    text: 'text-info-500',
  },
  prd_purchased: {
    key: 'status_prd_purchased',
    bg: 'bg-info-500/10',
    text: 'text-info-500',
  },
  matching: {
    key: 'status_matching',
    bg: 'bg-accent-coral-500/10',
    text: 'text-accent-coral-500',
  },
  team_forming: {
    key: 'status_team_forming',
    bg: 'bg-accent-coral-500/10',
    text: 'text-accent-coral-500',
  },
  matched: {
    key: 'status_matched',
    bg: 'bg-success-500/10',
    text: 'text-success-500',
  },
  in_progress: {
    key: 'status_in_progress',
    bg: 'bg-success-500/10',
    text: 'text-success-500',
  },
  partially_active: {
    key: 'status_partially_active',
    bg: 'bg-warning-500/20',
    text: 'text-primary-600',
  },
  review: {
    key: 'status_review',
    bg: 'bg-info-500/10',
    text: 'text-info-500',
  },
  completed: {
    key: 'status_completed',
    bg: 'bg-success-500/20',
    text: 'text-success-500',
  },
  cancelled: {
    key: 'status_cancelled',
    bg: 'bg-error-500/10',
    text: 'text-error-500',
  },
  disputed: {
    key: 'status_disputed',
    bg: 'bg-error-500/10',
    text: 'text-error-500',
  },
  on_hold: {
    key: 'status_on_hold',
    bg: 'bg-warning-500/20',
    text: 'text-primary-600',
  },
}

const CATEGORY_CONFIG: Record<string, { key: string; bg: string; text: string }> = {
  web_app: {
    key: 'web_app',
    bg: 'bg-info-500/10',
    text: 'text-info-500',
  },
  mobile_app: {
    key: 'mobile_app',
    bg: 'bg-success-500/10',
    text: 'text-success-500',
  },
  ui_ux_design: {
    key: 'ui_ux_design',
    bg: 'bg-accent-coral-500/10',
    text: 'text-accent-coral-500',
  },
  data_ai: {
    key: 'data_ai',
    bg: 'bg-accent-cream-500/20',
    text: 'text-primary-600',
  },
  other: {
    key: 'other',
    bg: 'bg-neutral-500/15',
    text: 'text-on-surface-muted',
  },
}

type ProjectItem = {
  id: string
  title: string
  category: string
  status: string
  budgetMin: number
  budgetMax: number
  createdAt: string
  updatedAt?: string
  teamSize?: number
  progress?: number
}

function ProjectListPage() {
  const { t } = useTranslation('project')
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const { data, isLoading, isError } = useProjects({
    ...(statusFilter ? { status: statusFilter } : {}),
    ownerId: user?.id,
  })

  const projects = (data?.items ?? []) as ProjectItem[]

  const activeProjects = useMemo(
    () => projects.filter((p) => ACTIVE_STATUSES.has(p.status)),
    [projects],
  )
  const completedProjects = useMemo(
    () => projects.filter((p) => COMPLETED_STATUSES.has(p.status)),
    [projects],
  )

  const tabs = useMemo(
    () => [
      {
        id: 'active',
        label: `${t('tab_active')} (${activeProjects.length})`,
      },
      {
        id: 'completed',
        label: `${t('tab_completed')} (${completedProjects.length})`,
      },
    ],
    [t, activeProjects.length, completedProjects.length],
  )

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-600">{t('my_projects')}</h1>
        <Link
          to="/projects/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Plus className="h-4 w-4" />
          {t('create_project')}
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none rounded-lg border border-outline-dim/20 bg-surface-container py-2 pl-3 pr-9 text-sm text-on-surface transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          >
            <option value="">{t('all_statuses')}</option>
            <option value="draft">{t('status_draft')}</option>
            <option value="scoping">{t('status_scoping')}</option>
            <option value="brd_generated">{t('status_brd_generated')}</option>
            <option value="brd_approved">{t('status_brd_approved')}</option>
            <option value="brd_purchased">{t('status_brd_purchased')}</option>
            <option value="prd_generated">{t('status_prd_generated')}</option>
            <option value="prd_approved">{t('status_prd_approved')}</option>
            <option value="prd_purchased">{t('status_prd_purchased')}</option>
            <option value="matching">{t('status_matching')}</option>
            <option value="team_forming">{t('status_team_forming')}</option>
            <option value="matched">{t('status_matched')}</option>
            <option value="in_progress">{t('status_in_progress')}</option>
            <option value="partially_active">{t('status_partially_active')}</option>
            <option value="review">{t('status_review')}</option>
            <option value="completed">{t('status_completed')}</option>
            <option value="cancelled">{t('status_cancelled')}</option>
            <option value="disputed">{t('status_disputed')}</option>
            <option value="on_hold">{t('status_on_hold')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-muted" />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-outline-dim/20 bg-surface-container p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              viewMode === 'grid'
                ? 'bg-primary-500/10 text-primary-600'
                : 'text-on-surface-muted hover:text-on-surface',
            )}
            aria-label={t('grid_view')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              viewMode === 'list'
                ? 'bg-primary-500/10 text-primary-600'
                : 'text-on-surface-muted hover:text-on-surface',
            )}
            aria-label={t('list_view')}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading && <ProjectListSkeleton viewMode={viewMode} />}

      {isError && (
        <div className="rounded-xl border border-error-500/20 bg-error-500/5 p-6 text-center">
          <p className="text-sm text-error-500">{t('load_error')}</p>
        </div>
      )}

      {!isLoading && !isError && projects.length === 0 && <EmptyState />}

      {!isLoading && !isError && projects.length > 0 && (
        <Tabs tabs={tabs} defaultTab="active">
          {(activeTab) =>
            activeTab === 'active' ? (
              <ActiveProjectList projects={activeProjects} viewMode={viewMode} t={t} />
            ) : (
              <CompletedProjectList projects={completedProjects} viewMode={viewMode} t={t} />
            )
          }
        </Tabs>
      )}
    </div>
  )
}

function ActiveProjectList({
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

function CompletedProjectList({
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

function EmptyState() {
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

function ProjectCard({
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
  const category = CATEGORY_CONFIG[project.category] ?? CATEGORY_CONFIG.other
  const statusLabel = t(status.key)
  const categoryLabel = t(category.key)

  if (viewMode === 'list') {
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="flex items-center gap-4 rounded-xl border border-outline-dim/20 bg-surface-bright p-4 transition-all hover:border-primary-500/30 hover:bg-surface-bright/80"
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
      className="group flex flex-col rounded-xl border border-outline-dim/20 bg-surface-bright p-5 transition-all hover:border-primary-500/30 hover:bg-surface-bright/80"
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

      <h3 className="mb-1 text-sm font-semibold text-on-surface line-clamp-2 group-hover:text-primary-600 transition-colors">
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

function ProjectListSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
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
