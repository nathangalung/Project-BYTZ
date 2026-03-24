import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  Flag,
  Loader2,
  MessageSquare,
  Paperclip,
  User,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useProject,
  useProjectMilestones,
  useReleaseEscrow,
  useUpdateMilestoneStatus,
} from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/milestones')({
  component: MilestoneBoardPage,
})

const COLUMNS = [
  'pending',
  'in_progress',
  'submitted',
  'revision_requested',
  'approved',
  'rejected',
] as const
type ColumnId = (typeof COLUMNS)[number]

const COLUMN_CONFIG: Record<ColumnId, { dotColor: string; headerColor: string }> = {
  pending: { dotColor: 'bg-accent-cream-500', headerColor: 'text-primary-600' },
  in_progress: { dotColor: 'bg-primary-600', headerColor: 'text-success-600' },
  submitted: { dotColor: 'bg-accent-cream-500', headerColor: 'text-primary-600' },
  revision_requested: {
    dotColor: 'bg-accent-coral-500',
    headerColor: 'text-accent-coral-600',
  },
  approved: { dotColor: 'bg-primary-600', headerColor: 'text-success-600' },
  rejected: { dotColor: 'bg-accent-coral-500', headerColor: 'text-accent-coral-600' },
}

type MilestoneItem = {
  id: string
  title: string
  description: string
  status: string
  amount: number
  dueDate: string | null
  revisionCount: number
  assignedWorkerLabel: string | null
  milestoneType: 'individual' | 'integration'
  orderIndex: number
}

function MilestoneBoardPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: fetchedMilestones, isLoading: milestonesLoading } = useProjectMilestones(projectId)

  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneItem | null>(null)
  const [rejectDialogMilestone, setRejectDialogMilestone] = useState<MilestoneItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const updateStatus = useUpdateMilestoneStatus()
  const releaseEscrow = useReleaseEscrow()
  const { addToast } = useToastStore()
  const milestones: MilestoneItem[] = (fetchedMilestones ?? []).map(
    (m: Record<string, unknown>) => ({
      id: m.id as string,
      title: m.title as string,
      description: (m.description as string) ?? '',
      status: m.status as string,
      amount: (m.amount as number) ?? 0,
      dueDate: (m.dueDate as string) ?? null,
      revisionCount: (m.revisionCount as number) ?? 0,
      assignedWorkerLabel: (m.assignedWorkerLabel as string) ?? null,
      milestoneType: ((m.milestoneType as string) ?? 'individual') as 'individual' | 'integration',
      orderIndex: (m.orderIndex as number) ?? 0,
    }),
  )

  const groupedMilestones = useCallback(() => {
    const groups: Record<ColumnId, MilestoneItem[]> = {
      pending: [],
      in_progress: [],
      submitted: [],
      revision_requested: [],
      approved: [],
      rejected: [],
    }
    for (const m of milestones) {
      const col = (m.status in groups ? m.status : 'pending') as ColumnId
      groups[col].push(m)
    }
    return groups
  }, [milestones])()

  async function handleStatusChange(milestoneId: string, newStatus: ColumnId) {
    if (newStatus === 'rejected') {
      const milestone = milestones.find((m) => m.id === milestoneId) ?? null
      setRejectDialogMilestone(milestone)
      setRejectReason('')
      return
    }

    try {
      await updateStatus.mutateAsync({
        milestoneId,
        status: newStatus,
        projectId,
      })

      if (newStatus === 'approved') {
        const milestone = milestones.find((m) => m.id === milestoneId)
        if (milestone && milestone.amount > 0) {
          try {
            await releaseEscrow.mutateAsync({
              projectId,
              milestoneId,
              amount: milestone.amount,
            })
            addToast(
              'success',
              t('milestone_approved_released', 'Milestone disetujui dan dana dicairkan'),
            )
          } catch {
            addToast(
              'warning',
              t(
                'milestone_approved_release_failed',
                'Milestone disetujui, tetapi pencairan dana gagal',
              ),
            )
          }
        } else {
          addToast('success', t('milestone_approved', 'Milestone disetujui'))
        }
      } else if (newStatus === 'revision_requested') {
        addToast('info', t('revision_requested_success', 'Permintaan revisi berhasil dikirim'))
      } else {
        addToast('success', t('status_updated', 'Status milestone diperbarui'))
      }

      if (selectedMilestone?.id === milestoneId) {
        setSelectedMilestone((prev) => (prev ? { ...prev, status: newStatus } : null))
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('status_update_failed', 'Gagal memperbarui status')
      addToast('error', msg)
    }
  }

  async function handleRejectConfirm() {
    if (!rejectDialogMilestone) return
    try {
      await updateStatus.mutateAsync({
        milestoneId: rejectDialogMilestone.id,
        status: 'rejected',
        projectId,
        reason: rejectReason || undefined,
      })
      addToast('success', t('milestone_rejected', 'Milestone ditolak'))
      if (selectedMilestone?.id === rejectDialogMilestone.id) {
        setSelectedMilestone((prev) => (prev ? { ...prev, status: 'rejected' } : null))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('reject_failed', 'Gagal menolak milestone')
      addToast('error', msg)
    } finally {
      setRejectDialogMilestone(null)
      setRejectReason('')
    }
  }

  const isMutating = updateStatus.isPending || releaseEscrow.isPending
  const isLoading = projectLoading || milestonesLoading

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-surface">
      {/* Header */}
      <div className="shrink-0 border-b border-outline-dim/20 bg-surface px-6 py-4">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-primary-600 flex items-center gap-2">
              <Flag className="h-5 w-5 text-success-600" />
              {t('milestones_board', 'Milestone Board')}
            </h1>
            <p className="mt-0.5 text-xs text-on-surface-muted">
              {milestones.length} {t('milestones').toLowerCase()}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-on-surface-muted">
              <Wallet className="h-4 w-4" />
              {t('total')}:{' '}
              <span className="font-bold text-primary-600">
                {formatCurrency(milestones.reduce((sum, m) => sum + m.amount, 0))}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto bg-surface-container p-4">
        <div className="flex gap-4" style={{ minWidth: 'fit-content' }}>
          {COLUMNS.map((columnId) => {
            const items = groupedMilestones[columnId]
            const config = COLUMN_CONFIG[columnId]
            return (
              <div key={columnId} className="w-72 shrink-0">
                {/* Column header */}
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 border border-outline-dim/10">
                  <span className={cn('h-2.5 w-2.5 rounded-full', config.dotColor)} />
                  <h3 className={cn('text-sm font-semibold', config.headerColor)}>{t(columnId)}</h3>
                  <span className="ml-auto rounded-full bg-surface-bright px-2 py-0.5 text-xs font-bold text-primary-600">
                    {items.length}
                  </span>
                </div>

                {/* Column cards */}
                <div className="space-y-2">
                  {items
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((milestone) => (
                      <MilestoneCard
                        key={milestone.id}
                        milestone={milestone}
                        onSelect={() => setSelectedMilestone(milestone)}
                        onStatusChange={handleStatusChange}
                        isMutating={isMutating}
                      />
                    ))}
                  {items.length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-outline-dim/20 p-4 text-center">
                      <p className="text-xs text-on-surface-muted/50">{t('no_milestones')}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Milestone detail slide-over */}
      {selectedMilestone && (
        <MilestoneDetail
          milestone={selectedMilestone}
          onClose={() => setSelectedMilestone(null)}
          onStatusChange={handleStatusChange}
          isMutating={isMutating}
        />
      )}

      {/* Rejection reason dialog */}
      {rejectDialogMilestone && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setRejectDialogMilestone(null)
              setRejectReason('')
            }}
            className="absolute inset-0 bg-black/50"
            aria-label="Close"
          />
          <div className="relative w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl border border-outline-dim/20">
            <h3 className="text-lg font-semibold text-primary-600 mb-2">
              {t('reject_milestone', 'Tolak Milestone')}
            </h3>
            <p className="text-sm text-on-surface-muted mb-4">
              {t('reject_reason_prompt', 'Berikan alasan penolakan untuk milestone ini:')}
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container p-3 text-sm text-on-surface placeholder:text-on-surface-muted/50 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              rows={4}
              placeholder={t('rejection_reason_placeholder', 'Jelaskan alasan penolakan...')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRejectDialogMilestone(null)
                  setRejectReason('')
                }}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container transition-colors"
              >
                {t('cancel', 'Batal')}
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={updateStatus.isPending}
                className="rounded-lg bg-accent-coral-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral-600/90 transition-colors disabled:opacity-50"
              >
                {updateStatus.isPending ? (
                  <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                ) : null}
                {t('confirm_reject', 'Tolak')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MilestoneCard({
  milestone,
  onSelect,
  onStatusChange,
  isMutating,
}: {
  milestone: MilestoneItem
  onSelect: () => void
  onStatusChange: (id: string, status: ColumnId) => void | Promise<void>
  isMutating: boolean
}) {
  const { t } = useTranslation('project')

  const isOverdue =
    milestone.dueDate &&
    new Date(milestone.dueDate) < new Date() &&
    milestone.status !== 'approved' &&
    milestone.status !== 'rejected'

  return (
    <div
      className={cn(
        'group cursor-pointer rounded-lg border p-3 transition-all hover:border-primary-500/30',
        isOverdue
          ? 'bg-surface-bright border-accent-coral-500/30'
          : 'bg-surface-bright border-outline-dim/10',
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-primary-600">{milestone.title}</h4>
          {milestone.milestoneType === 'integration' && (
            <span className="shrink-0 rounded bg-accent-coral-500/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-coral-600">
              {t('integration', 'Integrasi')}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-1 line-clamp-2 text-xs text-on-surface-muted">{milestone.description}</p>

        {/* Meta row */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {milestone.assignedWorkerLabel && (
              <span className="flex items-center gap-1 text-xs text-on-surface-muted">
                <User className="h-3 w-3" />
                {milestone.assignedWorkerLabel}
              </span>
            )}
          </div>
          <span className="text-xs font-bold text-primary-600">
            {formatCurrency(milestone.amount)}
          </span>
        </div>

        {/* Due date and revision count */}
        <div className="mt-2 flex items-center gap-3">
          {milestone.dueDate && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs',
                isOverdue ? 'text-accent-coral-600' : 'text-on-surface-muted',
              )}
            >
              {isOverdue ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
              {formatDate(milestone.dueDate)}
            </span>
          )}
          {milestone.revisionCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-primary-600">
              <MessageSquare className="h-3 w-3" />
              {milestone.revisionCount}/2
            </span>
          )}
        </div>
      </button>

      {/* Quick action buttons (visible on hover) */}
      {milestone.status === 'pending' && (
        <div className="mt-2 hidden border-t border-outline-dim/10 pt-2 group-hover:block">
          <button
            type="button"
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(milestone.id, 'in_progress')
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-success-600 hover:bg-primary-600/10 transition-colors disabled:opacity-50"
          >
            <ChevronRight className="h-3 w-3" />
            {t('in_progress')}
          </button>
        </div>
      )}
      {milestone.status === 'in_progress' && (
        <div className="mt-2 hidden border-t border-outline-dim/10 pt-2 group-hover:block">
          <button
            type="button"
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(milestone.id, 'submitted')
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-accent-cream-500/10 transition-colors disabled:opacity-50"
          >
            <ChevronRight className="h-3 w-3" />
            {t('submitted')}
          </button>
        </div>
      )}
    </div>
  )
}

function MilestoneDetail({
  milestone,
  onClose,
  onStatusChange,
  isMutating,
}: {
  milestone: MilestoneItem
  onClose: () => void
  onStatusChange: (id: string, status: ColumnId) => void | Promise<void>
  isMutating: boolean
}) {
  const { t } = useTranslation('project')

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
                  {t('integration_milestone', 'Milestone Integrasi')}
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
                {t('amount', 'Nominal')}
              </div>
              <p className="mt-1 text-sm font-bold text-primary-600">
                {formatCurrency(milestone.amount)}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-3 border border-outline-dim/10">
              <div className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                <Calendar className="h-3 w-3" />
                {t('due_date', 'Tenggat')}
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
                {t('talent', 'Talenta')}
              </div>
              <p className="mt-1 text-sm font-bold text-primary-600">
                {milestone.assignedWorkerLabel ?? '-'}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-3 border border-outline-dim/10">
              <div className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                <MessageSquare className="h-3 w-3" />
                {t('revision_requested', 'Revisi')}
              </div>
              <p className="mt-1 text-sm font-bold text-primary-600">{milestone.revisionCount}/2</p>
            </div>
          </div>

          {/* Attachments placeholder */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
              {t('attachments', 'Lampiran')}
            </h3>
            <div className="rounded-lg border-2 border-dashed border-outline-dim/20 p-4 text-center">
              <Paperclip className="mx-auto mb-1 h-5 w-5 text-on-surface-muted/40" />
              <p className="text-xs text-on-surface-muted/50">
                {t('no_attachments', 'Belum ada lampiran')}
              </p>
            </div>
          </div>

          {/* Actions based on status */}
          <div className="border-t border-outline-dim/20 pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-on-surface-muted">
              {t('actions', 'Aksi')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {milestone.status === 'pending' && (
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
                  {t('start', 'Mulai')}
                </button>
              )}
              {milestone.status === 'in_progress' && (
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
                  {t('submit', 'Kirim')}
                </button>
              )}
              {milestone.status === 'submitted' && (
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
                    {t('approve', 'Setujui')}
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
                    {t('reject', 'Tolak')}
                  </button>
                </>
              )}
              {milestone.status === 'revision_requested' && (
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
                  {t('resume_work', 'Lanjutkan')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
