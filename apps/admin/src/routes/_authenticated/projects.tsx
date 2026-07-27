import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Boxes,
  Calendar,
  DollarSign,
  Milestone,
  ShieldAlert,
  Users as UsersIcon,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Column, DataTable } from '@/components/ui/data-table'
import { DetailField, DetailSection } from '@/components/ui/detail-section'
import { FilterBar, SearchInput, SelectFilter } from '@/components/ui/filter-bar'
import { PageHeader } from '@/components/ui/page-header'
import { SlideOver } from '@/components/ui/slide-over'
import { StatusBadge } from '@/components/ui/status-badge'
import { useAdminList } from '@/hooks/use-admin-list'
import { apiGet } from '@/lib/api'
import { cn, formatDateShort, formatRp, initials } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects')({
  component: AdminProjectsPage,
})

type ProjectListItem = {
  id: string
  title: string
  ownerId: string
  ownerName: string
  ownerEmail: string
  status: string
  category: string
  teamSize: number
  budgetMin: number
  budgetMax: number
  finalPrice: number | null
  platformFee: number | null
  estimatedTimelineDays: number
  progress: number
  createdAt: string
}

type WorkPackageRow = {
  id: string
  title: string
  description: string
  orderIndex: number
  requiredSkills: unknown
  estimatedHours: number
  amount: number
  talentPayout: number
  status: string
}

type AssignmentRow = {
  id: string
  talentId: string
  talentUserId: string | null
  talentName: string | null
  roleLabel: string | null
  workPackageId: string | null
  workPackageTitle: string | null
  acceptanceStatus: string
  status: string
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

type MilestoneRow = {
  id: string
  workPackageId: string | null
  assignedTalentId: string | null
  title: string
  description: string
  milestoneType: string
  orderIndex: number
  amount: number
  status: string
  revisionCount: number
  dueDate: string
  submittedAt: string | null
}

type TransactionRow = {
  id: string
  workPackageId: string | null
  milestoneId: string | null
  talentId: string | null
  type: string
  amount: number
  status: string
  paymentMethod: string | null
  createdAt: string
}

type DisputeRow = {
  id: string
  workPackageId: string | null
  initiatedById: string
  initiatedByName: string | null
  againstUserId: string
  againstUserName: string | null
  reason: string
  status: string
  resolution: string | null
  resolutionType: string | null
  resolvedAt: string | null
  createdAt: string
}

type ProjectDetail = ProjectListItem & {
  description: string
  projectType: string
  companyName: string | null
  companyRole: string | null
  visibility: string
  completenessScore: number
  documentFileURL: string | null
  documentFileType: string | null
  talentPayout: number | null
  preferences: unknown
  updatedAt: string
  workPackages: WorkPackageRow[]
  workers: AssignmentRow[]
  milestones: MilestoneRow[]
  transactions: TransactionRow[]
  disputes: DisputeRow[]
}

const PROJECTS_PATH = '/api/v1/admin/projects'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-neutral-500/20 text-neutral-300',
  scoping: 'bg-warning-500/20 text-warning-500',
  brd_generated: 'bg-warning-500/20 text-warning-500',
  brd_approved: 'bg-warning-500/30 text-warning-500',
  brd_purchased: 'bg-success-500/20 text-success-500',
  prd_generated: 'bg-warning-500/20 text-warning-500',
  prd_approved: 'bg-success-500/20 text-success-500',
  prd_purchased: 'bg-success-500/20 text-success-500',
  matching: 'bg-warning-500/20 text-warning-500',
  team_forming: 'bg-warning-500/20 text-warning-500',
  matched: 'bg-success-500/20 text-success-500',
  in_progress: 'bg-success-500/20 text-success-500',
  partially_active: 'bg-warning-500/20 text-warning-500',
  review: 'bg-warning-500/20 text-warning-500',
  completed: 'bg-success-500/30 text-success-500',
  cancelled: 'bg-error-500/20 text-error-500',
  disputed: 'bg-error-500/20 text-error-500',
  on_hold: 'bg-neutral-500/20 text-neutral-300',
}

const MILESTONE_BADGE: Record<string, string> = {
  pending: 'bg-neutral-500/20 text-neutral-300',
  in_progress: 'bg-success-500/20 text-success-500',
  submitted: 'bg-warning-500/20 text-warning-500',
  approved: 'bg-success-500/30 text-success-500',
  rejected: 'bg-error-500/20 text-error-500',
  revision_requested: 'bg-warning-500/25 text-warning-500',
}

const ASSIGNMENT_BADGE: Record<string, string> = {
  active: 'bg-success-500/20 text-success-500',
  completed: 'bg-success-500/30 text-success-500',
}

const CATEGORY_LABELS: Record<string, string> = {
  web_app: 'Web App',
  mobile_app: 'Mobile App',
  ui_ux_design: 'UI/UX Design',
  data_ai: 'Data/AI',
  other_digital: 'Other Digital',
}

const STATUS_OPTIONS = [
  'draft',
  'scoping',
  'brd_generated',
  'prd_approved',
  'matching',
  'in_progress',
  'review',
  'completed',
  'cancelled',
  'disputed',
  'on_hold',
] as const

function progressColor(progress: number): string {
  if (progress >= 80) return 'text-success-500'
  if (progress >= 50) return 'text-warning-500'
  if (progress > 0) return 'text-warning-600'
  return 'text-neutral-300'
}

function progressBg(progress: number): string {
  if (progress >= 80) return 'bg-success-500'
  if (progress >= 50) return 'bg-warning-500'
  if (progress > 0) return 'bg-warning-600'
  return 'bg-neutral-500'
}

function transactionBadge(type: string): string {
  if (type.includes('release')) return 'bg-success-500/20 text-success-500'
  if (type.includes('refund')) return 'bg-error-500/20 text-error-500'
  return 'bg-warning-500/20 text-warning-500'
}

function AdminProjectsPage() {
  const { t } = useTranslation('admin')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = useAdminList<ProjectListItem>({
    queryKey: 'admin-projects',
    path: PROJECTS_PATH,
    initialFilters: { status: '' },
  })

  const detailQuery = useQuery({
    queryKey: ['admin-project-detail', selectedId],
    queryFn: () => apiGet<ProjectDetail>(`${PROJECTS_PATH}/${selectedId}`),
    enabled: !!selectedId,
  })
  const detail = detailQuery.data ?? null

  const statusLabel = useCallback(
    (status: string): string => t(`status_${status}`, status.replace(/_/g, ' ')),
    [t],
  )

  // A new array identity here re-sorts every row on each parent keystroke.
  const columns = useMemo<Column<ProjectListItem>[]>(
    () => [
      {
        key: 'title',
        header: t('col_project', 'Project'),
        sortValue: (project) => project.title,
        cellClassName: 'whitespace-normal',
        cell: (project) => (
          <div className="max-w-[240px]">
            <p className="truncate font-medium text-neutral-200">{project.title}</p>
            <p className="mt-0.5 text-xs text-neutral-300">
              {CATEGORY_LABELS[project.category] ?? project.category}
            </p>
          </div>
        ),
      },
      {
        key: 'owner',
        header: t('col_owner', 'Owner'),
        sortValue: (project) => project.ownerName || project.ownerEmail,
        cellClassName: 'text-neutral-300',
        cell: (project) => project.ownerName || project.ownerEmail || '-',
      },
      {
        key: 'status',
        header: t('col_status', 'Status'),
        cell: (project) => (
          <StatusBadge
            className={STATUS_BADGE[project.status] ?? STATUS_BADGE.draft}
            label={statusLabel(project.status)}
          />
        ),
      },
      {
        key: 'progress',
        header: t('progress', 'Progress'),
        sortValue: (project) => project.progress,
        cell: (project) => (
          <div className="flex items-center gap-2">
            <div className="h-2 w-16 overflow-hidden rounded-full bg-primary-700">
              <div
                className={cn('h-full rounded-full', progressBg(project.progress))}
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <span className={cn('text-xs font-semibold', progressColor(project.progress))}>
              {project.progress}%
            </span>
          </div>
        ),
      },
      {
        key: 'teamSize',
        header: t('col_team_size', 'Team'),
        sortValue: (project) => project.teamSize,
        cell: (project) => (
          <span className="inline-flex items-center gap-1 text-neutral-300">
            <UsersIcon className="h-3.5 w-3.5 text-neutral-300" />
            {project.teamSize}
          </span>
        ),
      },
      {
        key: 'budget',
        header: t('col_budget', 'Budget'),
        cell: (project) =>
          project.finalPrice ? (
            <span className="font-semibold text-warning-500">{formatRp(project.finalPrice)}</span>
          ) : (
            <span className="text-neutral-300">
              {formatRp(project.budgetMin)} - {formatRp(project.budgetMax)}
            </span>
          ),
      },
      {
        key: 'createdAt',
        header: t('col_created', 'Created'),
        sortValue: (project) => project.createdAt,
        cell: (project) => (
          <span className="inline-flex items-center gap-1 text-xs text-neutral-300">
            <Calendar className="h-3 w-3" />
            {formatDateShort(project.createdAt)}
          </span>
        ),
      },
    ],
    [t, statusLabel],
  )

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <PageHeader
        title={t('project_management', 'Project Management')}
        description={t('project_management_desc', 'Manage and monitor all platform projects')}
      />

      <FilterBar>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t('search_projects', 'Search by project title or owner...')}
        />
        <SelectFilter
          value={list.filters.status}
          onChange={(status) => list.setFilter('status', status)}
          label={t('col_status', 'Status')}
        >
          <option value="">{t('all_statuses', 'All Statuses')}</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </SelectFilter>
      </FilterBar>

      <p className="mb-4 text-sm text-neutral-300">
        {list.query.isLoading
          ? t('loading', 'Loading...')
          : t('showing_projects', 'Showing {{count}} projects', { count: list.items.length })}
      </p>

      <DataTable
        columns={columns}
        rows={list.items}
        rowKey={(project) => project.id}
        isLoading={list.query.isLoading}
        isError={list.query.isError}
        errorMessage={t('load_failed', 'Failed to load projects')}
        emptyMessage={t('no_projects_found', 'No projects found')}
        onRowSelect={(project) => setSelectedId(project.id)}
        rowLabel={(project) => project.title}
      />

      <SlideOver
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        closeLabel={t('close_panel', 'Close panel')}
        title={detail?.title ?? t('loading', 'Loading...')}
        subtitle={
          detail
            ? `${CATEGORY_LABELS[detail.category] ?? detail.category} · ${detail.ownerName || detail.ownerEmail}`
            : undefined
        }
      >
        {detailQuery.isLoading ? (
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded bg-primary-800/60" />
            <div className="h-32 animate-pulse rounded bg-primary-800/60" />
            <div className="h-32 animate-pulse rounded bg-primary-800/60" />
          </div>
        ) : detailQuery.isError ? (
          <div className="rounded-lg border border-error-500/30 bg-neutral-600 p-4">
            <p className="text-sm text-error-500">
              {t('load_failed', 'Failed to load project detail')}
            </p>
          </div>
        ) : detail ? (
          <div className="space-y-6">
            <DetailSection title={t('project_info', 'Project Info')}>
              {detail.description && (
                <p className="mb-3 text-sm text-neutral-300">{detail.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <DetailField label={t('col_status', 'Status')}>
                  <StatusBadge
                    className={STATUS_BADGE[detail.status] ?? STATUS_BADGE.draft}
                    label={statusLabel(detail.status)}
                  />
                </DetailField>
                <DetailField label={t('progress', 'Progress')}>
                  <span className={cn('font-bold', progressColor(detail.progress))}>
                    {detail.progress}%
                  </span>
                </DetailField>
                <DetailField label={t('col_budget', 'Budget')}>
                  <span className="font-semibold text-warning-500">
                    {detail.finalPrice
                      ? formatRp(detail.finalPrice)
                      : `${formatRp(detail.budgetMin)} - ${formatRp(detail.budgetMax)}`}
                  </span>
                </DetailField>
                <DetailField label={t('platform_fee', 'Platform Fee')}>
                  <span className="font-semibold">
                    {detail.platformFee ? formatRp(detail.platformFee) : '-'}
                  </span>
                </DetailField>
                <DetailField label={t('timeline', 'Timeline')}>
                  {detail.estimatedTimelineDays} {t('days_unit', 'days')}
                </DetailField>
                <DetailField label={t('project_type', 'Project Type')}>
                  <span className="capitalize">{detail.projectType.replace(/_/g, ' ')}</span>
                </DetailField>
              </div>
            </DetailSection>

            {detail.workPackages.length > 0 && (
              <DetailSection
                icon={<Boxes className="h-4 w-4" />}
                title={`${t('work_packages', 'Work Packages')} (${detail.workPackages.length})`}
              >
                <div className="space-y-2">
                  {detail.workPackages.map((wp) => (
                    <div key={wp.id} className="rounded-lg bg-primary-700 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-neutral-200">{wp.title}</p>
                        <span className="text-xs font-semibold text-warning-500">
                          {formatRp(wp.amount)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-300">
                        {wp.estimatedHours}h ·{' '}
                        <span className="capitalize">{wp.status.replace(/_/g, ' ')}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {detail.workers.length > 0 && (
              <DetailSection
                icon={<UsersIcon className="h-4 w-4" />}
                title={`${t('team', 'Team')} (${detail.workers.length})`}
              >
                <div className="space-y-2">
                  {detail.workers.map((worker) => (
                    <div
                      key={worker.id}
                      className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-800 text-xs font-semibold text-warning-500">
                          {initials(worker.talentName ?? '?')}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-200">
                            {worker.talentName ?? worker.talentId}
                          </p>
                          <p className="truncate text-xs text-neutral-300">
                            {worker.roleLabel ?? worker.workPackageTitle ?? '-'}
                          </p>
                        </div>
                      </div>
                      <StatusBadge
                        size="xs"
                        tone="error"
                        className={cn('shrink-0 capitalize', ASSIGNMENT_BADGE[worker.status])}
                        label={worker.status.replace(/_/g, ' ')}
                      />
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {detail.milestones.length > 0 && (
              <DetailSection
                icon={<Milestone className="h-4 w-4" />}
                title={`${t('milestones', 'Milestones')} (${detail.milestones.length})`}
              >
                <div className="space-y-2">
                  {detail.milestones.map((ms) => (
                    <div
                      key={ms.id}
                      className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-200">{ms.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-300">
                          <span>
                            {t('due', 'Due')}: {formatDateShort(ms.dueDate)}
                          </span>
                          {ms.revisionCount > 0 && <span>· {ms.revisionCount} rev</span>}
                        </div>
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-3">
                        <span className="text-xs font-semibold text-warning-500">
                          {formatRp(ms.amount)}
                        </span>
                        <StatusBadge
                          size="xs"
                          className={cn(
                            'capitalize',
                            MILESTONE_BADGE[ms.status] ?? MILESTONE_BADGE.pending,
                          )}
                          label={ms.status.replace(/_/g, ' ')}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {detail.transactions.length > 0 && (
              <DetailSection
                icon={<DollarSign className="h-4 w-4" />}
                title={`${t('transactions', 'Transactions')} (${detail.transactions.length})`}
              >
                <div className="space-y-2">
                  {detail.transactions.map((txn) => (
                    <div
                      key={txn.id}
                      className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                    >
                      <StatusBadge
                        size="xs"
                        className={cn('capitalize', transactionBadge(txn.type))}
                        label={txn.type.replace(/_/g, ' ')}
                      />
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-warning-500">
                          {formatRp(txn.amount)}
                        </span>
                        <span className="text-xs text-neutral-300">
                          {formatDateShort(txn.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {detail.disputes.length > 0 && (
              <DetailSection
                tone="danger"
                icon={<ShieldAlert className="h-4 w-4" />}
                title={`${t('disputes', 'Disputes')} (${detail.disputes.length})`}
              >
                <div className="space-y-2">
                  {detail.disputes.map((d) => (
                    <div key={d.id} className="rounded-lg bg-primary-700 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <StatusBadge
                          size="xs"
                          tone="error"
                          className="capitalize"
                          label={d.status.replace(/_/g, ' ')}
                        />
                        <span className="text-xs text-neutral-300">
                          {formatDateShort(d.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-200">
                        {d.initiatedByName ?? d.initiatedById} →{' '}
                        {d.againstUserName ?? d.againstUserId}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-neutral-300">{d.reason}</p>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}
          </div>
        ) : null}
      </SlideOver>
    </div>
  )
}
