import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AlertOctagon, CheckCircle2, Inbox, RefreshCw, Search, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/dlq')({
  component: DLQPage,
})

type DLQEntry = {
  id: string
  originalEventId: string
  eventType: string
  payload: unknown
  traceContext: unknown
  consumerService: string
  errorMessage: string
  retryCount: number
  reprocessed: boolean
  reprocessedAt: string | null
  createdAt: string
}

type DLQListResponse = {
  success: boolean
  data: {
    items: DLQEntry[]
    total: number
    page: number
    pageSize: number
  }
}

type DLQDetailResponse = {
  success: boolean
  data: DLQEntry
}

type ReprocessResponse = {
  success: boolean
  data: DLQEntry
}

const SKELETON_ROW_KEYS = ['s1', 's2', 's3', 's4', 's5'] as const

async function fetchDLQList(params: {
  reprocessed: string
  search: string
  page: number
  pageSize: number
}): Promise<DLQListResponse> {
  const query = new URLSearchParams()
  if (params.reprocessed) query.set('reprocessed', params.reprocessed)
  if (params.search) query.set('eventType', params.search)
  query.set('page', String(params.page))
  query.set('pageSize', String(params.pageSize))

  const res = await fetch(`/api/v1/admin/dlq?${query.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load DLQ entries')
  return res.json()
}

async function reprocessDLQ(input: { id: string; adminId: string }): Promise<ReprocessResponse> {
  const res = await fetch(`/api/v1/admin/dlq/${input.id}/reprocess`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId: input.adminId }),
  })
  if (!res.ok) throw new Error('Failed to reprocess DLQ event')
  return res.json()
}

function formatJson(value: unknown): string {
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function DLQPage() {
  const { t } = useTranslation('admin')
  const queryClient = useQueryClient()
  const adminId = useAuthStore((s) => s.user?.id ?? '')

  const [searchQuery, setSearchQuery] = useState('')
  const [reprocessedFilter, setReprocessedFilter] = useState<string>('')
  const [selected, setSelected] = useState<DLQEntry | null>(null)

  const dlqQuery = useQuery({
    queryKey: ['admin-dlq', reprocessedFilter, searchQuery],
    queryFn: () =>
      fetchDLQList({
        reprocessed: reprocessedFilter,
        search: searchQuery,
        page: 1,
        pageSize: 100,
      }),
  })

  const reprocessMutation = useMutation({
    mutationFn: reprocessDLQ,
    onSuccess: (data: DLQDetailResponse) => {
      queryClient.invalidateQueries({ queryKey: ['admin-dlq'] })
      setSelected(data.data)
    },
  })

  const entries = dlqQuery.data?.data.items ?? []
  const pendingCount = entries.filter((e) => !e.reprocessed).length
  const reprocessedCount = entries.filter((e) => e.reprocessed).length

  function handleReprocess(id: string) {
    if (!adminId) return
    reprocessMutation.mutate({ id, adminId })
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">{t('dlq', 'Dead Letter Queue')}</h1>
        <p className="mt-1 text-sm text-neutral-300">
          {t('dlq_desc', 'Failed events for manual triage and reprocessing')}
        </p>
      </div>

      {/* Status tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-primary-700 p-1">
        <button
          type="button"
          onClick={() => setReprocessedFilter('')}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            !reprocessedFilter
              ? 'bg-neutral-600 text-warning-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {t('all_dlq', 'All')} ({entries.length})
        </button>
        <button
          type="button"
          onClick={() => setReprocessedFilter('false')}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            reprocessedFilter === 'false'
              ? 'bg-neutral-600 text-error-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {t('status_pending', 'Pending')} ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setReprocessedFilter('true')}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            reprocessedFilter === 'true'
              ? 'bg-neutral-600 text-success-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {t('status_reprocessed', 'Reprocessed')} ({reprocessedCount})
        </button>
      </div>

      {/* Search */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_dlq', 'Filter by event type...')}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>
      </div>

      <p className="mb-4 text-sm text-neutral-300">
        {dlqQuery.isLoading
          ? t('loading', 'Loading...')
          : t('showing_dlq_count', 'Showing {{count}} entries', { count: entries.length })}
      </p>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary-700/60">
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('timestamp', 'Timestamp')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('event_type', 'Event Type')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('consumer_service', 'Consumer')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('retry_count', 'Retries')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_status', 'Status')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('error_message', 'Error')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {dlqQuery.isLoading ? (
                SKELETON_ROW_KEYS.map((rowKey) => (
                  <tr key={rowKey} className="animate-pulse">
                    <td className="px-4 py-3">
                      <div className="h-3 w-24 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-32 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-20 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-8 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-16 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-48 rounded bg-primary-700/50" />
                    </td>
                  </tr>
                ))
              ) : dlqQuery.isError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-error-500">
                    {t('load_failed', 'Failed to load data')}
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-neutral-300">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="h-8 w-8 text-neutral-400" />
                      <p>{t('no_dlq_entries', 'No DLQ entries found')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="cursor-pointer transition-colors hover:bg-primary-700/30"
                    onClick={() => setSelected(entry)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-300">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-500/20 px-2.5 py-0.5 text-xs font-semibold text-warning-500">
                        <AlertOctagon className="h-3 w-3" />
                        {entry.eventType}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-300">
                      {entry.consumerService}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-error-500/15 px-2 py-0.5 text-xs font-semibold text-error-500">
                        {entry.retryCount}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {entry.reprocessed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-500/20 px-2.5 py-0.5 text-xs font-semibold text-success-500">
                          <CheckCircle2 className="h-3 w-3" />
                          {t('status_reprocessed', 'Reprocessed')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-error-500/20 px-2.5 py-0.5 text-xs font-semibold text-error-500">
                          <AlertOctagon className="h-3 w-3" />
                          {t('status_pending', 'Pending')}
                        </span>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate text-xs text-neutral-300" title={entry.errorMessage}>
                        {entry.errorMessage}
                      </p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail slide-over */}
      {selected && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-primary-900/60 backdrop-blur-sm"
            onClick={() => setSelected(null)}
            onKeyDown={(e) => e.key === 'Escape' && setSelected(null)}
            tabIndex={-1}
            aria-label="Close panel"
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-primary-700 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-primary-600/50 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-500/20 text-error-500">
                  <AlertOctagon className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-warning-500">{selected.eventType}</h2>
                  <p className="text-xs text-neutral-300">
                    {selected.consumerService} · {formatDateTime(selected.createdAt)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg p-2 text-neutral-300 hover:bg-primary-600 hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Metadata */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('event_metadata', 'Event Metadata')}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <p className="text-xs text-neutral-300">
                        {t('original_event_id', 'Original Event ID')}
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-neutral-200">
                        {selected.originalEventId}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">
                        {t('consumer_service', 'Consumer')}
                      </p>
                      <p className="mt-1 text-sm text-neutral-200">{selected.consumerService}</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('retry_count', 'Retries')}</p>
                      <p className="mt-1 text-sm text-neutral-200">{selected.retryCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_status', 'Status')}</p>
                      <div className="mt-1">
                        {selected.reprocessed ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success-500">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t('status_reprocessed', 'Reprocessed')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-error-500">
                            <AlertOctagon className="h-3.5 w-3.5" />
                            {t('status_pending', 'Pending')}
                          </span>
                        )}
                      </div>
                    </div>
                    {selected.reprocessedAt && (
                      <div>
                        <p className="text-xs text-neutral-300">
                          {t('reprocessed_at', 'Reprocessed At')}
                        </p>
                        <p className="mt-1 text-sm text-neutral-200">
                          {formatDateTime(selected.reprocessedAt)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Error */}
                <div className="rounded-lg border border-error-500/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-error-500">
                    {t('error_message', 'Error Message')}
                  </h3>
                  <pre className="whitespace-pre-wrap break-words text-xs text-neutral-200">
                    {selected.errorMessage}
                  </pre>
                </div>

                {/* Payload */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('payload', 'Payload')}
                  </h3>
                  <pre className="max-h-96 overflow-auto rounded-md bg-primary-900 p-3 font-mono text-xs text-neutral-200">
                    {formatJson(selected.payload)}
                  </pre>
                </div>

                {/* Trace Context */}
                {selected.traceContext != null && (
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-warning-500">
                      {t('trace_context', 'Trace Context')}
                    </h3>
                    <pre className="max-h-48 overflow-auto rounded-md bg-primary-900 p-3 font-mono text-xs text-neutral-200">
                      {formatJson(selected.traceContext)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Footer actions */}
            <div className="border-t border-primary-600/50 px-6 py-4">
              {selected.reprocessed ? (
                <p className="text-center text-sm text-success-500">
                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                  {t('already_reprocessed', 'This event has already been marked as reprocessed')}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-neutral-300">
                    {t(
                      'reprocess_hint',
                      'Marking acknowledges manual triage. Republish the payload out-of-band before clicking.',
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleReprocess(selected.id)}
                    disabled={reprocessMutation.isPending || !adminId}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-success-500 px-4 py-2.5 text-sm font-semibold text-primary-900 transition-colors hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw
                      className={cn('h-4 w-4', reprocessMutation.isPending && 'animate-spin')}
                    />
                    {reprocessMutation.isPending
                      ? t('processing', 'Processing...')
                      : t('mark_reprocessed', 'Mark as Reprocessed')}
                  </button>
                  {reprocessMutation.isError && (
                    <p className="text-center text-xs text-error-500">
                      {t('action_failed', 'Action failed. Try again.')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
