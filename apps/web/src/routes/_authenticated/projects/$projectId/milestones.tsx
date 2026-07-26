import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Flag, Loader2, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GanttView } from '@/components/project/gantt-view'
import { MilestoneCard } from '@/components/project/milestones/milestone-card'
import { MilestoneDetail } from '@/components/project/milestones/milestone-detail'
import {
  COLUMN_CONFIG,
  COLUMNS,
  type ColumnId,
  type Deliverable,
  type MilestoneItem,
} from '@/components/project/milestones/shared'
import { Tabs } from '@/components/ui/tabs'
import { useProject, useProjectMilestones, useUpdateMilestoneStatus } from '@/hooks/use-projects'
import { subscribeTo } from '@/lib/centrifugo'
import { cn, formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/milestones')({
  component: MilestoneBoardPage,
})

function MilestoneBoardPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: fetchedMilestones, isLoading: milestonesLoading } = useProjectMilestones(projectId)

  // Subscribe to real-time milestone status changes for this project.
  useEffect(() => {
    if (!projectId) return
    const unsubscribe = subscribeTo(`milestone:${projectId}`, () => {
      queryClient.invalidateQueries({ queryKey: ['project-milestones', projectId] })
    })
    return unsubscribe
  }, [projectId, queryClient])

  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneItem | null>(null)
  const [rejectDialogMilestone, setRejectDialogMilestone] = useState<MilestoneItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const updateStatus = useUpdateMilestoneStatus()
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()
  // Owner reviews, talent delivers.
  const role = useAuthStore((s) => s.user?.role)
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
      metadata: (m.metadata as { deliverables?: Deliverable[] } | null) ?? null,
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
        // Escrow settles server-side on approve; the talent is anonymous here.
        addToast('success', t('milestone_approved'))
      } else if (newStatus === 'revision_requested') {
        addToast('info', t('revision_requested_success'))
      } else {
        addToast('success', t('status_updated'))
      }

      if (selectedMilestone?.id === milestoneId) {
        setSelectedMilestone((prev) => (prev ? { ...prev, status: newStatus } : null))
      }
    } catch (err) {
      // Past the two free revisions the backend asks for payment; send the
      // owner to the revision-fee checkout instead of a dead-end toast.
      if (
        newStatus === 'revision_requested' &&
        err instanceof Error &&
        err.message.includes('revision limit')
      ) {
        addToast('info', t('revision_fee_required'))
        navigate({
          to: '/projects/$projectId/checkout',
          params: { projectId },
          search: { type: 'revision', milestoneId },
        })
        return
      }
      const msg = err instanceof Error ? err.message : t('status_update_failed')
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
      addToast('success', t('milestone_rejected'))
      if (selectedMilestone?.id === rejectDialogMilestone.id) {
        setSelectedMilestone((prev) => (prev ? { ...prev, status: 'rejected' } : null))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('reject_failed')
      addToast('error', msg)
    } finally {
      setRejectDialogMilestone(null)
      setRejectReason('')
    }
  }

  const isMutating = updateStatus.isPending
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
              {t('milestones_board')}
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

      {/* Tabs: Board | Gantt */}
      <div className="flex-1 overflow-y-auto bg-surface-container p-4">
        <Tabs
          tabs={[
            { id: 'board', label: t('milestones_board') },
            { id: 'gantt', label: t('gantt_view') ?? 'Gantt View' },
          ]}
          defaultTab="board"
        >
          {(activeTab) =>
            activeTab === 'board' ? (
              <div className="overflow-x-auto">
                <div className="flex gap-4" style={{ minWidth: 'fit-content' }}>
                  {COLUMNS.map((columnId) => {
                    const items = groupedMilestones[columnId]
                    const config = COLUMN_CONFIG[columnId]
                    return (
                      <div key={columnId} className="w-72 shrink-0">
                        {/* Column header */}
                        <div className="mb-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 border border-outline-dim/10">
                          <span className={cn('h-2.5 w-2.5 rounded-full', config.dotColor)} />
                          <h3 className={cn('text-sm font-semibold', config.headerColor)}>
                            {t(columnId)}
                          </h3>
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
                                role={role}
                              />
                            ))}
                          {items.length === 0 && (
                            <div className="rounded-lg border-2 border-dashed border-outline-dim/20 p-4 text-center">
                              <p className="text-xs text-on-surface-muted/50">
                                {t('no_milestones')}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <GanttView projectId={projectId} />
            )
          }
        </Tabs>
      </div>

      {/* Milestone detail slide-over */}
      {selectedMilestone && (
        <MilestoneDetail
          milestone={selectedMilestone}
          onClose={() => setSelectedMilestone(null)}
          onStatusChange={handleStatusChange}
          isMutating={isMutating}
          role={role}
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
            <h3 className="text-lg font-semibold text-primary-600 mb-2">{t('reject_milestone')}</h3>
            <p className="text-sm text-on-surface-muted mb-4">{t('reject_reason_prompt')}</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container p-3 text-sm text-on-surface placeholder:text-on-surface-muted/50 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              rows={4}
              placeholder={t('rejection_reason_placeholder')}
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
                {t('cancel')}
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
                {t('confirm_reject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
