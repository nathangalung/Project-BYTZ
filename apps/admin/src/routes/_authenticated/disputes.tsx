import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Gavel,
  MessageSquare,
  RefreshCw,
  Scale,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/disputes')({
  component: AdminDisputesPage,
})

type DisputeStatus = 'open' | 'under_review' | 'mediation' | 'resolved' | 'escalated'
type ResolutionType = 'funds_to_talent' | 'funds_to_owner' | 'split'

type DisputeRow = {
  id: string
  projectId: string
  projectTitle: string
  workPackageId: string | null
  workPackageTitle: string | null
  initiatedBy: string
  initiatedByName: string
  initiatedByRole: string
  againstUserId: string
  againstUserName: string
  againstUserRole: string
  reason: string
  status: DisputeStatus
  amount: number
  resolutionType: ResolutionType | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

type DisputeStatusEvent = {
  fromStatus: string
  toStatus: string
  createdAt: string
}

type DisputeDetail = DisputeRow & {
  evidenceUrls: string[]
  resolution: string | null
  resolvedBy: string | null
  statusHistory: DisputeStatusEvent[]
}

type DisputeListResponse = {
  success: boolean
  data: { items: DisputeRow[]; total: number; page: number; pageSize: number }
}

const STATUS_CONFIG: Record<
  DisputeStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  open: {
    color: 'bg-error-500/20 text-error-500',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: 'Open',
  },
  under_review: {
    color: 'bg-warning-500/20 text-warning-500',
    icon: <Eye className="h-3.5 w-3.5" />,
    label: 'Under Review',
  },
  mediation: {
    color: 'bg-warning-500/25 text-warning-600',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    label: 'Mediation',
  },
  resolved: {
    color: 'bg-success-500/20 text-success-500',
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    label: 'Resolved',
  },
  escalated: {
    color: 'bg-error-500/30 text-error-500',
    icon: <Gavel className="h-3.5 w-3.5" />,
    label: 'Escalated',
  },
}

const STATUS_KEYS: DisputeStatus[] = ['open', 'under_review', 'mediation', 'escalated', 'resolved']

async function fetchDisputes(params: {
  status: string
  page: number
  pageSize: number
}): Promise<DisputeListResponse['data']> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  query.set('page', String(params.page))
  query.set('pageSize', String(params.pageSize))
  const res = await fetch(`/api/v1/admin/disputes?${query.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load disputes')
  const body = (await res.json()) as DisputeListResponse
  return body.data
}

async function fetchStatusCounts(): Promise<Record<DisputeStatus, number>> {
  const res = await fetch('/api/v1/admin/disputes/status-counts', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load dispute counts')
  const body = (await res.json()) as { success: boolean; data: Record<DisputeStatus, number> }
  return body.data
}

async function fetchDisputeDetail(id: string): Promise<DisputeDetail> {
  const res = await fetch(`/api/v1/admin/disputes/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load dispute detail')
  const body = (await res.json()) as { success: boolean; data: DisputeDetail }
  return body.data
}

async function transitionStatus(input: { id: string; status: DisputeStatus }) {
  const res = await fetch(`/api/v1/disputes/${input.id}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: input.status }),
  })
  if (!res.ok) throw new Error('Failed to transition status')
}

async function resolveDispute(input: {
  id: string
  resolution: string
  resolutionType: ResolutionType
}) {
  const res = await fetch(`/api/v1/disputes/${input.id}/resolve`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: input.resolution, resolutionType: input.resolutionType }),
  })
  if (!res.ok) throw new Error('Failed to resolve dispute')
}

function formatRp(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
  return `Rp ${n.toLocaleString('id-ID')}`
}

function AdminDisputesPage() {
  const { t } = useTranslation('admin')
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')

  const pageSize = 50

  const listQuery = useQuery({
    queryKey: ['admin-disputes', statusFilter, pageSize],
    queryFn: () => fetchDisputes({ status: statusFilter, page: 1, pageSize }),
  })

  const countsQuery = useQuery({
    queryKey: ['admin-disputes-counts'],
    queryFn: fetchStatusCounts,
  })

  const detailQuery = useQuery({
    queryKey: ['admin-dispute', expandedId],
    queryFn: () => fetchDisputeDetail(expandedId as string),
    enabled: !!expandedId,
  })

  const transitionMutation = useMutation({
    mutationFn: transitionStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-disputes'] })
      queryClient.invalidateQueries({ queryKey: ['admin-disputes-counts'] })
      if (expandedId) {
        queryClient.invalidateQueries({ queryKey: ['admin-dispute', expandedId] })
      }
    },
  })

  const resolveMutation = useMutation({
    mutationFn: resolveDispute,
    onSuccess: () => {
      setResolutionNote('')
      queryClient.invalidateQueries({ queryKey: ['admin-disputes'] })
      queryClient.invalidateQueries({ queryKey: ['admin-disputes-counts'] })
      if (expandedId) {
        queryClient.invalidateQueries({ queryKey: ['admin-dispute', expandedId] })
      }
    },
  })

  const disputes = listQuery.data?.items ?? []
  const counts = countsQuery.data

  const detailMap = new Map<string, DisputeDetail>()
  if (detailQuery.data) detailMap.set(detailQuery.data.id, detailQuery.data)

  function roleColor(role: string) {
    return role === 'owner' ? 'text-warning-500' : 'text-error-500'
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warning-500">
            {t('disputes', 'Dispute Management')}
          </h1>
          <p className="mt-1 text-sm text-neutral-300">
            {t('disputes_desc', 'Manage and resolve platform disputes')}
          </p>
        </div>
        <div className="relative">
          <select
            value={statusFilter || 'all'}
            onChange={(e) => setStatusFilter(e.target.value === 'all' ? '' : e.target.value)}
            className="appearance-none rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-3 pr-9 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          >
            <option value="all">{t('all_status', 'All Status')}</option>
            <option value="open">{t('status_open', 'Open')}</option>
            <option value="under_review">{t('status_under_review', 'Under Review')}</option>
            <option value="mediation">{t('status_mediation', 'Mediation')}</option>
            <option value="escalated">{t('status_escalated', 'Escalated')}</option>
            <option value="resolved">{t('status_resolved', 'Resolved')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STATUS_KEYS.map((key) => {
          const config = STATUS_CONFIG[key]
          const count = counts?.[key] ?? 0
          const active = statusFilter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(active ? '' : key)}
              className={cn(
                'rounded-lg border p-3 text-center transition-colors',
                active
                  ? 'border-success-500/50 bg-primary-700'
                  : 'border-neutral-600/30 bg-neutral-600 hover:bg-primary-700/50',
              )}
            >
              <div className="flex items-center justify-center gap-1.5">
                {config.icon}
                <span className="text-lg font-bold text-warning-500">
                  {countsQuery.isLoading ? '–' : count}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-300">{t(`status_${key}`, config.label)}</p>
            </button>
          )
        })}
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-4">
          {['s1', 's2', 's3'].map((k) => (
            <div
              key={k}
              className="h-28 animate-pulse rounded-xl border border-neutral-600/30 bg-neutral-600"
            />
          ))}
        </div>
      ) : listQuery.isError ? (
        <div className="rounded-xl border border-error-500/40 bg-error-500/10 p-6 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-error-500" />
          <p className="mt-3 text-sm text-error-500">
            {t('disputes_load_failed', 'Failed to load disputes')}
          </p>
          <button
            type="button"
            onClick={() => listQuery.refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-error-500/20 px-3 py-1.5 text-xs font-semibold text-error-500 hover:bg-error-500/30"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('retry', 'Retry')}
          </button>
        </div>
      ) : disputes.length === 0 ? (
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 py-12 text-center">
          <CheckCircle className="mx-auto h-10 w-10 text-neutral-300" />
          <p className="mt-3 text-sm text-neutral-300">
            {t('no_disputes', 'No disputes for this filter')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => {
            const config = STATUS_CONFIG[dispute.status]
            const isExpanded = expandedId === dispute.id
            const detail = detailMap.get(dispute.id)
            return (
              <div
                key={dispute.id}
                className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : dispute.id)}
                  className="w-full p-5 text-left transition-colors hover:bg-primary-700/20"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-semibold text-warning-500">{dispute.projectTitle}</h3>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            config.color,
                          )}
                        >
                          {config.icon} {t(`status_${dispute.status}`, config.label)}
                        </span>
                        {dispute.workPackageTitle && (
                          <span className="rounded-full bg-primary-700 px-2.5 py-0.5 text-xs text-neutral-300">
                            {dispute.workPackageTitle}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-300">
                        <span className={roleColor(dispute.initiatedByRole)}>
                          {dispute.initiatedByName}
                        </span>
                        <ArrowRight className="h-3 w-3 text-neutral-600" />
                        <span className={roleColor(dispute.againstUserRole)}>
                          {dispute.againstUserName}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-neutral-300">{dispute.reason}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-warning-500">
                        {formatRp(dispute.amount)}
                      </p>
                      <p className="mt-1 text-xs text-neutral-300">
                        {formatDateShort(dispute.createdAt)}
                      </p>
                      <ChevronDown
                        className={cn(
                          'mx-auto mt-2 h-4 w-4 text-neutral-300 transition-transform',
                          isExpanded && 'rotate-180',
                        )}
                      />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-primary-700/40 bg-primary-700/20">
                    {detailQuery.isLoading ? (
                      <div className="p-6">
                        <div className="h-32 animate-pulse rounded-lg bg-primary-700" />
                      </div>
                    ) : detailQuery.isError ? (
                      <div className="p-6 text-center">
                        <p className="text-sm text-error-500">
                          {t('dispute_detail_failed', 'Failed to load dispute detail')}
                        </p>
                        <button
                          type="button"
                          onClick={() => detailQuery.refetch()}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-error-500/20 px-3 py-1.5 text-xs font-semibold text-error-500 hover:bg-error-500/30"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t('retry', 'Retry')}
                        </button>
                      </div>
                    ) : detail ? (
                      <DisputeDetailPanel
                        dispute={detail}
                        resolutionNote={resolutionNote}
                        onResolutionNoteChange={setResolutionNote}
                        onTransition={(status) =>
                          transitionMutation.mutate({ id: detail.id, status })
                        }
                        onResolve={(resolutionType) =>
                          resolveMutation.mutate({
                            id: detail.id,
                            resolution: resolutionNote,
                            resolutionType,
                          })
                        }
                        transitionPending={transitionMutation.isPending}
                        resolvePending={resolveMutation.isPending}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type DetailPanelProps = {
  dispute: DisputeDetail
  resolutionNote: string
  onResolutionNoteChange: (v: string) => void
  onTransition: (status: DisputeStatus) => void
  onResolve: (resolutionType: ResolutionType) => void
  transitionPending: boolean
  resolvePending: boolean
}

function DisputeDetailPanel({
  dispute,
  resolutionNote,
  onResolutionNoteChange,
  onTransition,
  onResolve,
  transitionPending,
  resolvePending,
}: DetailPanelProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-2">
      <div className="space-y-6">
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
            <FileText className="h-4 w-4" />
            {t('evidence', 'Evidence')} ({dispute.evidenceUrls.length})
          </h4>
          {dispute.evidenceUrls.length === 0 ? (
            <p className="text-xs text-neutral-300">{t('no_evidence', 'No evidence attached')}</p>
          ) : (
            <div className="space-y-2">
              {dispute.evidenceUrls.map((url) => {
                const filename = url.split('/').pop() ?? url
                return (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-success-500/50 hover:text-success-500"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{filename}</span>
                  </a>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
            <Clock className="h-4 w-4" />
            {t('status_timeline', 'Status Timeline')}
          </h4>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-neutral-500" />
              <div className="flex-1">
                <p className="text-xs text-neutral-300">
                  {t('dispute_created', 'Dispute Created')}
                </p>
              </div>
              <span className="text-xs text-neutral-300">{formatDateShort(dispute.createdAt)}</span>
            </div>
            {dispute.statusHistory.map((event) => (
              <div
                key={`${event.fromStatus}-${event.toStatus}-${event.createdAt}`}
                className="flex items-center gap-3"
              >
                <div className="h-2 w-2 rounded-full bg-success-500" />
                <div className="flex-1">
                  <p className="text-xs text-neutral-300">
                    {t(`status_${event.fromStatus}`, event.fromStatus)}{' '}
                    <ArrowRight className="inline h-3 w-3 text-neutral-300" />{' '}
                    {t(`status_${event.toStatus}`, event.toStatus)}
                  </p>
                </div>
                <span className="text-xs text-neutral-300">{formatDateShort(event.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        {dispute.resolutionType && (
          <div className="rounded-lg border border-success-500/30 bg-success-500/10 p-4">
            <h4 className="mb-2 text-sm font-semibold text-success-500">
              {t('resolution', 'Resolution')}
            </h4>
            <p className="mb-1 text-xs font-medium text-success-500">
              {dispute.resolutionType === 'funds_to_talent' &&
                t('funds_to_talent', 'Funds Released to Talent')}
              {dispute.resolutionType === 'funds_to_owner' &&
                t('funds_to_owner', 'Funds Refunded to Owner')}
              {dispute.resolutionType === 'split' && t('funds_split', 'Funds Split 50/50')}
            </p>
            {dispute.resolution && <p className="text-xs text-neutral-300">{dispute.resolution}</p>}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {dispute.status !== 'resolved' && (
          <>
            <div>
              <h4 className="mb-3 text-sm font-semibold text-warning-500">
                {t('change_status', 'Change Status')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {dispute.status === 'open' && (
                  <button
                    type="button"
                    onClick={() => onTransition('under_review')}
                    disabled={transitionPending}
                    className="rounded-lg bg-warning-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-warning-600 disabled:opacity-50"
                  >
                    <Eye className="mr-1 inline h-3.5 w-3.5" />
                    {t('start_review', 'Start Review')}
                  </button>
                )}
                {dispute.status === 'under_review' && (
                  <button
                    type="button"
                    onClick={() => onTransition('mediation')}
                    disabled={transitionPending}
                    className="rounded-lg bg-warning-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-warning-600 disabled:opacity-50"
                  >
                    <MessageSquare className="mr-1 inline h-3.5 w-3.5" />
                    {t('begin_mediation', 'Begin Mediation')}
                  </button>
                )}
                {(dispute.status === 'mediation' || dispute.status === 'under_review') && (
                  <button
                    type="button"
                    onClick={() => onTransition('escalated')}
                    disabled={transitionPending}
                    className="rounded-lg bg-error-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-error-600 disabled:opacity-50"
                  >
                    <Gavel className="mr-1 inline h-3.5 w-3.5" />
                    {t('escalate', 'Escalate')}
                  </button>
                )}
              </div>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold text-warning-500">
                {t('resolve_dispute', 'Resolve Dispute')}
              </h4>
              <textarea
                value={resolutionNote}
                onChange={(e) => onResolutionNoteChange(e.target.value)}
                placeholder={t('resolution_reasoning', 'Enter resolution reasoning...')}
                rows={3}
                className="mb-3 w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onResolve('funds_to_talent')}
                  disabled={resolvePending || !resolutionNote.trim()}
                  className="rounded-lg bg-success-500 px-4 py-2 text-xs font-semibold text-primary-800 hover:bg-success-600 disabled:opacity-50"
                >
                  {t('release_to_talent', 'Release to Talent')}
                </button>
                <button
                  type="button"
                  onClick={() => onResolve('funds_to_owner')}
                  disabled={resolvePending || !resolutionNote.trim()}
                  className="rounded-lg border border-error-500/50 px-4 py-2 text-xs font-semibold text-error-500 hover:bg-error-500/10 disabled:opacity-50"
                >
                  {t('refund_to_owner', 'Refund to Owner')}
                </button>
                <button
                  type="button"
                  onClick={() => onResolve('split')}
                  disabled={resolvePending || !resolutionNote.trim()}
                  className="rounded-lg border border-warning-500/50 px-4 py-2 text-xs font-semibold text-warning-500 hover:bg-warning-500/10 disabled:opacity-50"
                >
                  <Scale className="mr-1 inline h-3.5 w-3.5" />
                  {t('split_5050', 'Split 50/50')}
                </button>
              </div>
            </div>
          </>
        )}

        {dispute.status === 'resolved' && (
          <div className="rounded-lg border border-success-500/30 bg-success-500/10 p-4 text-center">
            <CheckCircle className="mx-auto h-8 w-8 text-success-500" />
            <p className="mt-2 text-sm font-semibold text-success-500">
              {t('dispute_resolved_message', 'This dispute is resolved')}
            </p>
            {dispute.resolvedAt && (
              <p className="mt-1 text-xs text-neutral-300">{formatDateShort(dispute.resolvedAt)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
