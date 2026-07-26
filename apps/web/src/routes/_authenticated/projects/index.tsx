import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronDown, LayoutGrid, List, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProjectListSkeleton } from '@/components/project/list/project-card'
import {
  ActiveProjectList,
  CompletedProjectList,
  EmptyState,
} from '@/components/project/list/project-lists'
import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  type ProjectItem,
} from '@/components/project/list/shared'
import { Tabs } from '@/components/ui/tabs'
import { useProjects } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/projects/')({
  component: ProjectListPage,
})

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
