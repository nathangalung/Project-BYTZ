import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Calendar,
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjects } from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/')({
  component: ProjectListPage,
})

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft: {
    label: 'Draft',
    bg: 'bg-neutral-500/20',
    text: 'text-neutral-300',
  },
  scoping: {
    label: 'Scoping',
    bg: 'bg-info-500/15',
    text: 'text-info-500',
  },
  brd_generated: {
    label: 'BRD Review',
    bg: 'bg-warning-500/15',
    text: 'text-warning-500',
  },
  brd_approved: {
    label: 'BRD Approved',
    bg: 'bg-warning-500/20',
    text: 'text-warning-500',
  },
  prd_generated: {
    label: 'PRD Review',
    bg: 'bg-info-500/15',
    text: 'text-info-500',
  },
  matching: {
    label: 'Matching',
    bg: 'bg-accent-coral-500/15',
    text: 'text-accent-coral-500',
  },
  in_progress: {
    label: 'In Progress',
    bg: 'bg-success-500/15',
    text: 'text-success-500',
  },
  review: {
    label: 'Review',
    bg: 'bg-info-500/15',
    text: 'text-info-500',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-success-500/20',
    text: 'text-success-500',
  },
  cancelled: {
    label: 'Cancelled',
    bg: 'bg-error-500/15',
    text: 'text-error-500',
  },
}

const CATEGORY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  web_app: {
    label: 'Web App',
    bg: 'bg-info-500/15',
    text: 'text-info-500',
  },
  mobile_app: {
    label: 'Mobile App',
    bg: 'bg-success-500/15',
    text: 'text-success-500',
  },
  ui_ux_design: {
    label: 'UI/UX Design',
    bg: 'bg-accent-coral-500/15',
    text: 'text-accent-coral-500',
  },
  data_ai: {
    label: 'Data / AI',
    bg: 'bg-warning-500/15',
    text: 'text-warning-500',
  },
  other_digital: {
    label: 'Other',
    bg: 'bg-neutral-500/15',
    text: 'text-neutral-400',
  },
}

function ProjectListPage() {
  const { t } = useTranslation('project')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const { data, isLoading, isError } = useProjects(
    statusFilter ? { status: statusFilter } : undefined,
  )

  const projects = (data?.items ?? []) as Array<{
    id: string
    title: string
    category: string
    status: string
    budgetMin: number
    budgetMax: number
    createdAt: string
    teamSize?: number
    progress?: number
  }>

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-warning-500">{t('my_projects', 'Proyek Saya')}</h1>
        <Link
          to="/projects/new"
          className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2.5 text-sm font-semibold text-primary-900 shadow-sm transition-colors hover:bg-success-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-500"
        >
          <Plus className="h-4 w-4" />
          {t('create_project', 'Buat Proyek')}
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none rounded-lg border border-primary-500/30 bg-primary-700 py-2 pl-3 pr-9 text-sm text-neutral-200 transition-colors focus:border-success-500 focus:outline-none focus:ring-1 focus:ring-success-500"
          >
            <option value="">{t('all_statuses', 'Semua Status')}</option>
            <option value="draft">{t('status_draft', 'Draft')}</option>
            <option value="scoping">{t('status_scoping', 'Scoping')}</option>
            <option value="brd_generated">{t('status_brd_generated', 'BRD Generated')}</option>
            <option value="in_progress">{t('status_in_progress', 'In Progress')}</option>
            <option value="completed">{t('status_completed', 'Completed')}</option>
            <option value="cancelled">{t('status_cancelled', 'Cancelled')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-primary-500/30 bg-primary-700 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              viewMode === 'grid'
                ? 'bg-success-500/20 text-success-500'
                : 'text-neutral-400 hover:text-neutral-200',
            )}
            aria-label={t('grid_view', 'Grid view')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              viewMode === 'list'
                ? 'bg-success-500/20 text-success-500'
                : 'text-neutral-400 hover:text-neutral-200',
            )}
            aria-label={t('list_view', 'List view')}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading && <ProjectListSkeleton viewMode={viewMode} />}

      {isError && (
        <div className="rounded-xl border border-error-500/20 bg-error-500/5 p-6 text-center">
          <p className="text-sm text-error-500">
            {t('load_error', 'Gagal memuat proyek. Silakan coba lagi.')}
          </p>
        </div>
      )}

      {!isLoading && !isError && projects.length === 0 && <EmptyState />}

      {!isLoading && !isError && projects.length > 0 && (
        <div
          className={
            viewMode === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-3'
          }
        >
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} viewMode={viewMode} />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation('project')

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-700/30 bg-neutral-600 py-16">
      <div className="mb-4 rounded-full bg-primary-700/50 p-4">
        <FolderOpen className="h-8 w-8 text-neutral-400" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-warning-500">
        {t('no_projects', 'Belum ada proyek')}
      </h3>
      <p className="mb-6 max-w-sm text-center text-sm text-neutral-400">
        {t(
          'no_projects_description',
          'Mulai proyek pertama Anda dan wujudkan ide digital Anda bersama kami.',
        )}
      </p>
      <Link
        to="/projects/new"
        className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2.5 text-sm font-semibold text-primary-900 shadow-sm transition-colors hover:bg-success-600"
      >
        <Plus className="h-4 w-4" />
        {t('create_project', 'Buat Proyek')}
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
  const category = CATEGORY_CONFIG[project.category] ?? CATEGORY_CONFIG.other_digital
  const statusLabel = t(`status_${project.status}`, status.label)
  const categoryLabel = t(project.category, category.label)

  if (viewMode === 'list') {
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="flex items-center gap-4 rounded-xl border border-neutral-700/30 bg-neutral-600 p-4 transition-all hover:border-success-500/30 hover:bg-neutral-600/80"
      >
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-neutral-100">{project.title}</h3>
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
            <span className="flex items-center gap-1 text-neutral-400">
              <Calendar className="h-3 w-3" />
              {formatDate(project.createdAt)}
            </span>
            {(project.teamSize ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-neutral-400">
                <Users className="h-3 w-3" />
                {project.teamSize}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-sm text-neutral-300">
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
        <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-500" />
      </Link>
    )
  }

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="group flex flex-col rounded-xl border border-neutral-700/30 bg-neutral-600 p-5 transition-all hover:border-success-500/30 hover:bg-neutral-600/80"
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

      <h3 className="mb-1 text-sm font-semibold text-neutral-100 line-clamp-2 group-hover:text-warning-500 transition-colors">
        {project.title}
      </h3>

      {(project.teamSize ?? 0) > 0 && (
        <div className="mb-2 flex items-center gap-1 text-xs text-neutral-400">
          <Users className="h-3 w-3" />
          {project.teamSize} {t('workers', 'workers')}
        </div>
      )}

      {(project.progress ?? 0) > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-neutral-400">{t('progress', 'Progress')}</span>
            <span className="font-medium text-success-500">{project.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary-800">
            <div
              className="h-full rounded-full bg-success-500"
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto space-y-2 border-t border-primary-500/20 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">{t('budget', 'Budget')}</span>
          <span className="font-medium text-neutral-200">
            {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">{t('created', 'Dibuat')}</span>
          <span className="text-neutral-300">{formatDate(project.createdAt)}</span>
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
            className="h-16 animate-pulse rounded-xl border border-neutral-700/30 bg-neutral-600/50"
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
          className="h-48 animate-pulse rounded-xl border border-neutral-700/30 bg-neutral-600/50"
        />
      ))}
    </div>
  )
}
