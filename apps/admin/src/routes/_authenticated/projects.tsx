import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Boxes,
  Calendar,
  ChevronDown,
  DollarSign,
  Milestone,
  Search,
  ShieldAlert,
  Users as UsersIcon,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

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

type ProjectListResponse = {
  success: boolean
  data: {
    items: ProjectListItem[]
    total: number
    page: number
    pageSize: number
  }
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

type ProjectDetailResponse = {
  success: boolean
  data: ProjectDetail
}

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

const CATEGORY_LABELS: Record<string, string> = {
  web_app: 'Web App',
  mobile_app: 'Mobile App',
  ui_ux_design: 'UI/UX Design',
  data_ai: 'Data/AI',
  other_digital: 'Other Digital',
}

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

function formatRp(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
  return `Rp ${n.toLocaleString('id-ID')}`
}

async function fetchProjects(params: {
  status: string
  search: string
  page: number
  pageSize: number
}): Promise<ProjectListResponse> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.search) query.set('search', params.search)
  query.set('page', String(params.page))
  query.set('pageSize', String(params.pageSize))

  const res = await fetch(`/api/v1/admin/projects?${query.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load projects')
  return res.json()
}

async function fetchProjectDetail(id: string): Promise<ProjectDetailResponse> {
  const res = await fetch(`/api/v1/admin/projects/${id}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load project detail')
  return res.json()
}

function AdminProjectsPage() {
  const { t } = useTranslation('admin')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const listQuery = useQuery({
    queryKey: ['admin-projects', statusFilter, searchQuery],
    queryFn: () =>
      fetchProjects({
        status: statusFilter,
        search: searchQuery,
        page: 1,
        pageSize: 100,
      }),
  })

  const detailQuery = useQuery({
    queryKey: ['admin-project-detail', selectedId],
    queryFn: () => fetchProjectDetail(selectedId ?? ''),
    enabled: !!selectedId,
  })

  const projects = listQuery.data?.data.items ?? []
  const detail = detailQuery.data?.data ?? null

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">
          {t('project_management', 'Project Management')}
        </h1>
        <p className="mt-1 text-sm text-neutral-300">
          {t('project_management_desc', 'Manage and monitor all platform projects')}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('search_projects', 'Search by project title or owner...')}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-3 pr-9 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          >
            <option value="">{t('all_statuses', 'All Statuses')}</option>
            <option value="draft">{t('status_draft', 'Draft')}</option>
            <option value="scoping">{t('status_scoping', 'Scoping')}</option>
            <option value="brd_generated">{t('status_brd_generated', 'BRD Generated')}</option>
            <option value="prd_approved">{t('status_prd_approved', 'PRD Approved')}</option>
            <option value="matching">{t('status_matching', 'Matching')}</option>
            <option value="in_progress">{t('status_in_progress', 'In Progress')}</option>
            <option value="review">{t('status_review', 'Review')}</option>
            <option value="completed">{t('status_completed', 'Completed')}</option>
            <option value="cancelled">{t('status_cancelled', 'Cancelled')}</option>
            <option value="disputed">{t('status_disputed', 'Disputed')}</option>
            <option value="on_hold">{t('status_on_hold', 'On Hold')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
        </div>
      </div>

      <p className="mb-4 text-sm text-neutral-300">
        {listQuery.isLoading
          ? t('loading', 'Loading...')
          : t('showing_projects', 'Showing {{count}} projects', { count: projects.length })}
      </p>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary-700/60">
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_project', 'Project')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_owner', 'Owner')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_status', 'Status')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('progress', 'Progress')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_team_size', 'Team')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_budget', 'Budget')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_created', 'Created')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {listQuery.isError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-error-500">
                    {t('load_failed', 'Failed to load projects')}
                  </td>
                </tr>
              ) : listQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                  <tr key={`skeleton-${i}`}>
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-6 animate-pulse rounded bg-primary-700/60" />
                    </td>
                  </tr>
                ))
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-neutral-300">
                    {t('no_projects_found', 'No projects found')}
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr
                    key={project.id}
                    onClick={() => setSelectedId(project.id)}
                    className="cursor-pointer transition-colors hover:bg-primary-700/30"
                  >
                    <td className="px-4 py-3">
                      <div className="max-w-[240px]">
                        <p className="truncate font-medium text-neutral-200">{project.title}</p>
                        <p className="mt-0.5 text-xs text-neutral-300">
                          {CATEGORY_LABELS[project.category] ?? project.category}
                        </p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-300">
                      {project.ownerName || project.ownerEmail || '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_BADGE[project.status] ?? STATUS_BADGE.draft,
                        )}
                      >
                        {t(`status_${project.status}`, project.status.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-primary-700">
                          <div
                            className={cn('h-full rounded-full', progressBg(project.progress))}
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        <span
                          className={cn('text-xs font-semibold', progressColor(project.progress))}
                        >
                          {project.progress}%
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-neutral-300">
                        <UsersIcon className="h-3.5 w-3.5 text-neutral-300" />
                        {project.teamSize}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {project.finalPrice ? (
                        <span className="font-semibold text-warning-500">
                          {formatRp(project.finalPrice)}
                        </span>
                      ) : (
                        <span className="text-neutral-300">
                          {formatRp(project.budgetMin)} - {formatRp(project.budgetMax)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-neutral-300">
                        <Calendar className="h-3 w-3" />
                        {formatDateShort(project.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail slide-over */}
      {selectedId && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-primary-900/60 backdrop-blur-sm"
            onClick={() => setSelectedId(null)}
            onKeyDown={(e) => e.key === 'Escape' && setSelectedId(null)}
            tabIndex={-1}
            aria-label="Close panel"
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-primary-700 shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-primary-600/50 px-6 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-warning-500">
                  {detail?.title ?? t('loading', 'Loading...')}
                </h2>
                {detail && (
                  <p className="mt-1 text-xs text-neutral-300">
                    {CATEGORY_LABELS[detail.category] ?? detail.category} ·{' '}
                    {detail.ownerName || detail.ownerEmail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-lg p-2 text-neutral-300 hover:bg-primary-600 hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-6">
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
                  {/* Project info */}
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-warning-500">
                      {t('project_info', 'Project Info')}
                    </h3>
                    {detail.description && (
                      <p className="mb-3 text-sm text-neutral-300">{detail.description}</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-neutral-300">{t('col_status', 'Status')}</p>
                        <span
                          className={cn(
                            'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            STATUS_BADGE[detail.status] ?? STATUS_BADGE.draft,
                          )}
                        >
                          {t(`status_${detail.status}`, detail.status.replace(/_/g, ' '))}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">{t('progress', 'Progress')}</p>
                        <p className={cn('mt-1 text-sm font-bold', progressColor(detail.progress))}>
                          {detail.progress}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">{t('col_budget', 'Budget')}</p>
                        <p className="mt-1 text-sm font-semibold text-warning-500">
                          {detail.finalPrice
                            ? formatRp(detail.finalPrice)
                            : `${formatRp(detail.budgetMin)} - ${formatRp(detail.budgetMax)}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">
                          {t('platform_fee', 'Platform Fee')}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-neutral-300">
                          {detail.platformFee ? formatRp(detail.platformFee) : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">{t('timeline', 'Timeline')}</p>
                        <p className="mt-1 text-sm text-neutral-300">
                          {detail.estimatedTimelineDays} {t('days_unit', 'days')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">
                          {t('project_type', 'Project Type')}
                        </p>
                        <p className="mt-1 text-sm capitalize text-neutral-300">
                          {detail.projectType.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Work packages */}
                  {detail.workPackages.length > 0 && (
                    <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                        <Boxes className="h-4 w-4" />
                        {t('work_packages', 'Work Packages')} ({detail.workPackages.length})
                      </h3>
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
                    </div>
                  )}

                  {/* Team */}
                  {detail.workers.length > 0 && (
                    <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                        <UsersIcon className="h-4 w-4" />
                        {t('team', 'Team')} ({detail.workers.length})
                      </h3>
                      <div className="space-y-2">
                        {detail.workers.map((worker) => (
                          <div
                            key={worker.id}
                            className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-800 text-xs font-semibold text-warning-500">
                                {(worker.talentName ?? '?')
                                  .split(' ')
                                  .map((n) => n[0])
                                  .join('')
                                  .substring(0, 2)
                                  .toUpperCase()}
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
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                                worker.status === 'active'
                                  ? 'bg-success-500/20 text-success-500'
                                  : worker.status === 'completed'
                                    ? 'bg-success-500/30 text-success-500'
                                    : 'bg-error-500/20 text-error-500',
                              )}
                            >
                              {worker.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Milestones */}
                  {detail.milestones.length > 0 && (
                    <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                        <Milestone className="h-4 w-4" />
                        {t('milestones', 'Milestones')} ({detail.milestones.length})
                      </h3>
                      <div className="space-y-2">
                        {detail.milestones.map((ms) => (
                          <div
                            key={ms.id}
                            className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-neutral-200">
                                {ms.title}
                              </p>
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
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                                  MILESTONE_BADGE[ms.status] ?? MILESTONE_BADGE.pending,
                                )}
                              >
                                {ms.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transactions */}
                  {detail.transactions.length > 0 && (
                    <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                        <DollarSign className="h-4 w-4" />
                        {t('transactions', 'Transactions')} ({detail.transactions.length})
                      </h3>
                      <div className="space-y-2">
                        {detail.transactions.map((txn) => (
                          <div
                            key={txn.id}
                            className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                          >
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                                txn.type.includes('release')
                                  ? 'bg-success-500/20 text-success-500'
                                  : txn.type.includes('refund')
                                    ? 'bg-error-500/20 text-error-500'
                                    : 'bg-warning-500/20 text-warning-500',
                              )}
                            >
                              {txn.type.replace(/_/g, ' ')}
                            </span>
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
                    </div>
                  )}

                  {/* Disputes */}
                  {detail.disputes.length > 0 && (
                    <div className="rounded-lg border border-error-500/30 bg-neutral-600 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-error-500">
                        <ShieldAlert className="h-4 w-4" />
                        {t('disputes', 'Disputes')} ({detail.disputes.length})
                      </h3>
                      <div className="space-y-2">
                        {detail.disputes.map((d) => (
                          <div key={d.id} className="rounded-lg bg-primary-700 px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="rounded-full bg-error-500/20 px-2 py-0.5 text-[10px] font-semibold capitalize text-error-500">
                                {d.status.replace(/_/g, ' ')}
                              </span>
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
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
