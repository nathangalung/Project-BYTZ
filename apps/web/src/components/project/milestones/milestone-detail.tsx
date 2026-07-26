import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  Upload,
  User,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '@/lib/api'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'
import {
  type ColumnId,
  formatFileSize,
  type MilestoneComment,
  type MilestoneFile,
  type MilestoneItem,
} from './shared'

export function MilestoneDetail({
  milestone,
  onClose,
  onStatusChange,
  isMutating,
  role,
}: {
  milestone: MilestoneItem
  onClose: () => void
  onStatusChange: (id: string, status: ColumnId) => void | Promise<void>
  isMutating: boolean
  role?: string
}) {
  const { t } = useTranslation('project')
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [uploading, setUploading] = useState(false)

  const { data: files = [] } = useQuery<MilestoneFile[]>({
    queryKey: ['milestone-files', milestone.id],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/milestones/${milestone.id}/files`), {
        credentials: 'include',
      })
      if (!res.ok) return []
      const json = (await res.json()) as { data: MilestoneFile[] }
      return json.data ?? []
    },
  })

  // Rejection and revision reasons land here; the talent reads them in-thread.
  const { data: comments = [] } = useQuery<MilestoneComment[]>({
    queryKey: ['milestone-comments', milestone.id],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/milestones/${milestone.id}/comments`), {
        credentials: 'include',
      })
      if (!res.ok) return []
      const json = (await res.json()) as { data: MilestoneComment[] }
      return json.data ?? []
    },
  })

  const deliverables = milestone.metadata?.deliverables ?? []

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const presignRes = await fetch(apiUrl('/api/v1/upload/presigned-url'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileType: file.type, folder: 'milestone' }),
      })
      if (!presignRes.ok) throw new Error('presign failed')
      const presignJson = (await presignRes.json()) as { data: { url: string } }
      const { url } = presignJson.data
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      const publicUrl = url.split('?')[0]
      const recordRes = await fetch(apiUrl(`/api/v1/milestones/${milestone.id}/files`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileUrl: publicUrl,
          fileSize: file.size,
          mimeType: file.type,
        }),
      })
      if (!recordRes.ok) throw new Error('record failed')
      await qc.invalidateQueries({ queryKey: ['milestone-files', milestone.id] })
      addToast('success', t('file_uploaded'))
    } catch {
      addToast('error', t('upload_failed'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const isOverdue =
    milestone.dueDate &&
    new Date(milestone.dueDate) < new Date() &&
    milestone.status !== 'approved' &&
    milestone.status !== 'rejected'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md overflow-y-auto bg-surface shadow-2xl border-l border-outline-dim/20">
        <div className="border-b border-outline-dim/20 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-primary-600">{milestone.title}</h2>
              {milestone.milestoneType === 'integration' && (
                <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent-coral-500/15 px-2 py-0.5 text-xs font-medium text-accent-coral-600">
                  {t('integration_milestone')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-on-surface-muted hover:text-primary-600 transition-colors"
              aria-label="Close"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Description */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
              {t('description')}
            </h3>
            <p className="text-sm leading-relaxed text-on-surface-muted">{milestone.description}</p>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-surface-container p-3 border border-outline-dim/10">
              <div className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                <Wallet className="h-3 w-3" />
                {t('amount')}
              </div>
              <p className="mt-1 text-sm font-bold text-primary-600">
                {formatCurrency(milestone.amount)}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-3 border border-outline-dim/10">
              <div className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                <Calendar className="h-3 w-3" />
                {t('due_date')}
              </div>
              <p
                className={cn(
                  'mt-1 text-sm font-bold',
                  isOverdue ? 'text-accent-coral-600' : 'text-primary-600',
                )}
              >
                {milestone.dueDate ? formatDate(milestone.dueDate) : '-'}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-3 border border-outline-dim/10">
              <div className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                <User className="h-3 w-3" />
                {t('talent')}
              </div>
              <p className="mt-1 text-sm font-bold text-primary-600">
                {milestone.assignedWorkerLabel ?? '-'}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-3 border border-outline-dim/10">
              <div className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                <MessageSquare className="h-3 w-3" />
                {t('revision_requested')}
              </div>
              <p className="mt-1 text-sm font-bold text-primary-600">{milestone.revisionCount}/2</p>
            </div>
          </div>

          {/* Attachments */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
                {t('attachments')}
              </h3>
              <label
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-600/10 transition-colors',
                  uploading && 'pointer-events-none opacity-50',
                )}
              >
                {uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                {t('upload_file')}
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  onChange={handleFileUpload}
                />
              </label>
            </div>
            {files.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-outline-dim/20 p-4 text-center">
                <Paperclip className="mx-auto mb-1 h-5 w-5 text-on-surface-muted/40" />
                <p className="text-xs text-on-surface-muted/50">{t('no_attachments')}</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-outline-dim/10 bg-surface-container px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-on-surface-muted" />
                      <span className="truncate text-xs font-medium text-on-surface">
                        {f.fileName}
                      </span>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-2">
                      <span className="text-[10px] text-on-surface-muted">
                        {formatFileSize(f.fileSize)}
                      </span>
                      <a
                        href={f.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-semibold text-primary-600 hover:underline"
                      >
                        {t('download')}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Deliverables checklist from the PRD */}
          {deliverables.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
                {t('deliverables')}
              </h3>
              <ul className="space-y-1.5">
                {deliverables.map((d) => (
                  <li
                    key={d.title}
                    className="rounded-lg border border-outline-dim/10 bg-surface-container px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-on-surface">{d.title}</span>
                      {d.type && (
                        <span className="rounded bg-primary-600/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-600">
                          {d.type}
                        </span>
                      )}
                    </div>
                    {d.expected && (
                      <p className="mt-1 text-[11px] text-on-surface-muted">{d.expected}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Feedback thread: rejection and revision reasons */}
          {comments.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
                {t('feedback')}
              </h3>
              <ul className="space-y-1.5">
                {comments.map((cm) => (
                  <li
                    key={cm.id}
                    className="rounded-lg border border-accent-coral-500/10 bg-surface-container px-3 py-2"
                  >
                    <p className="text-xs leading-relaxed text-on-surface">{cm.content}</p>
                    <p className="mt-1 text-[10px] text-on-surface-muted">
                      {new Date(cm.createdAt).toLocaleString('id-ID')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions based on status */}
          <div className="border-t border-outline-dim/20 pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
              {t('actions')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {role === 'talent' && milestone.status === 'pending' && (
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={() => onStatusChange(milestone.id, 'in_progress')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors disabled:opacity-50"
                >
                  {isMutating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {t('start')}
                </button>
              )}
              {role === 'talent' && milestone.status === 'in_progress' && (
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={() => onStatusChange(milestone.id, 'submitted')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-cream-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-cream-500/90 transition-colors disabled:opacity-50"
                >
                  {isMutating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {t('submit')}
                </button>
              )}
              {role === 'owner' && milestone.status === 'submitted' && (
                <>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => onStatusChange(milestone.id, 'approved')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors disabled:opacity-50"
                  >
                    {isMutating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4" />
                    )}
                    {t('approve')}
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => onStatusChange(milestone.id, 'revision_requested')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-cream-500/30 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-surface-bright transition-colors disabled:opacity-50"
                  >
                    {isMutating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                    {t('request_revision')}
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => onStatusChange(milestone.id, 'rejected')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-coral-500/30 px-4 py-2 text-sm font-medium text-accent-coral-600 hover:bg-accent-coral-500/10 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    {t('reject')}
                  </button>
                </>
              )}
              {role === 'talent' && milestone.status === 'revision_requested' && (
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={() => onStatusChange(milestone.id, 'in_progress')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors disabled:opacity-50"
                >
                  {isMutating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {t('resume_work')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
