import { FREE_MILESTONE_REVISIONS } from '@kerjacus/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Flag, Loader2, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MilestoneCard } from '@/components/project/milestones/milestone-card'
import { MilestoneDetail } from '@/components/project/milestones/milestone-detail'
import {
  COLUMN_CONFIG,
  COLUMNS,
  type ColumnId,
  type Deliverable,
  type MilestoneItem,
} from '@/components/project/milestones/shared'
import { LazyPanel } from '@/components/ui/lazy-panel'
import { QueryError } from '@/components/ui/query-error'
import { Tabs } from '@/components/ui/tabs'
import { useProject, useProjectMilestones, useUpdateMilestoneStatus } from '@/hooks/use-projects'
import { ApiError, isNotFound } from '@/lib/api'
import { subscribeTo } from '@/lib/centrifugo'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { cn, formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/milestones')({
  component: MilestoneBoardPage,
})

// SVAR Gantt plus its stylesheet only matter on the Gantt tab.
const GanttView = lazyWithRetry<{ projectId: string }>(() =>
  import('@/components/project/gantt-view').then((m) => ({ default: m.GanttView })),
)

function MilestoneBoardPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()
  const {
    data: project,
    isLoading: projectLoading,
    isError: projectIsError,
    error: projectError,
    refetch: refetchProject,
  } = useProject(projectId)
  const {
    data: fetchedMilestones,
    isLoading: milestonesLoading,
    isError: milestonesError,
    refetch: refetchMilestones,
  } = useProjectMilestones(projectId)

  // Subscribe to real-time milestone status changes for this project.
  useEffect(() => {
    if (!projectId) return
    const unsubscribe = subscribeTo(`milestone:${projectId}`, () => {
      queryClient.invalidateQueries({ queryKey: ['project-milestones', projectId] })
    })
    return unsubscribe
  }, [projectId, queryClient])

  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneItem | null>(null)
  const [revisionDialogMilestone, setRevisionDialogMilestone] = useState<MilestoneItem | null>(null)
  const [revisionReason, setRevisionReason] = useState('')
  const updateStatus = useUpdateMilestoneStatus()
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()
  // Owner reviews, talent delivers.
  const role = useAuthStore((s) => s.user?.role)
  /**
   * Who owns a milestone, by way of its work package.
   *
   * The card has always rendered `assignedWorkerLabel` and the server has never
   * sent that field, so the line was blank on every board this platform has
   * drawn. The milestone carries work_package_id and the project detail already
   * returns a role label per assignment, so the name was one join away the whole
   * time. Not milestones.assigned_talent_id: that is a talent_profiles id, and
   * nothing on this page can turn it into a name.
   */
  const roleByWorkPackage = useMemo(() => {
    const map = new Map<string, string>()
    for (const assignment of project?.assignments ?? []) {
      if (assignment.workPackageId && assignment.roleLabel) {
        map.set(assignment.workPackageId, assignment.roleLabel)
      }
    }
    return map
  }, [project?.assignments])

  const milestones: MilestoneItem[] = useMemo(
    () =>
      (fetchedMilestones ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        title: m.title as string,
        description: (m.description as string) ?? '',
        status: m.status as string,
        amount: (m.amount as number) ?? 0,
        dueDate: (m.dueDate as string) ?? null,
        revisionCount: (m.revisionCount as number) ?? 0,
        assignedWorkerLabel: roleByWorkPackage.get(m.workPackageId as string) ?? null,
        milestoneType: ((m.milestoneType as string) ?? 'individual') as
          | 'individual'
          | 'integration',
        orderIndex: (m.orderIndex as number) ?? 0,
        metadata: (m.metadata as { deliverables?: Deliverable[] } | null) ?? null,
      })),
    [fetchedMilestones, roleByWorkPackage],
  )

  const groupedMilestones = useMemo(() => {
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
  }, [milestones])

  async function handleStatusChange(milestoneId: string, newStatus: ColumnId) {
    // A revision the talent cannot act on is the failure this dialog prevents,
    // so the request routes through it rather than firing from the button.
    if (newStatus === 'revision_requested') {
      const milestone = milestones.find((m) => m.id === milestoneId) ?? null
      setRevisionDialogMilestone(milestone)
      setRevisionReason('')
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
      } else {
        addToast('success', t('status_updated'))
      }

      if (selectedMilestone?.id === milestoneId) {
        setSelectedMilestone((prev) => (prev ? { ...prev, status: newStatus } : null))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('status_update_failed')
      addToast('error', msg)
    }
  }

  async function handleRevisionConfirm() {
    const milestone = revisionDialogMilestone
    const reason = revisionReason.trim()
    if (!milestone || !reason) return
    try {
      await updateStatus.mutateAsync({
        milestoneId: milestone.id,
        status: 'revision_requested',
        projectId,
        reason,
      })
      addToast('info', t('revision_requested_success'))
      if (selectedMilestone?.id === milestone.id) {
        setSelectedMilestone((prev) => (prev ? { ...prev, status: 'revision_requested' } : null))
      }
      setRevisionDialogMilestone(null)
      setRevisionReason('')
    } catch (err) {
      // Past the free rounds the backend asks for payment; send the owner to
      // the revision-fee checkout instead of a dead-end toast. The count is
      // not repeated here - it lives in FREE_MILESTONE_REVISIONS, and the
      // copy that named it stayed at two after the constant moved to three.
      if (err instanceof ApiError && err.code === 'MILESTONE_REVISION_LIMIT') {
        setRevisionDialogMilestone(null)
        setRevisionReason('')
        addToast('info', t('revision_fee_required'))
        navigate({
          to: '/projects/$projectId/checkout',
          params: { projectId },
          search: { type: 'revision', milestoneId: milestone.id },
        })
        return
      }
      // The dialog stays open on failure so the typed points are not lost.
      const msg = err instanceof Error ? err.message : t('status_update_failed')
      addToast('error', msg)
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

  // A board with no answer is not a board with no milestones. Only a 404 on the
  // project says it is gone; every other status says the question went unasked.
  const loadFailed = milestonesError || (projectIsError && !isNotFound(projectError))
  if (loadFailed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <QueryError
          message={milestonesError ? t('milestones_load_failed') : t('project_load_failed')}
          onRetry={() => {
            if (milestonesError) void refetchMilestones()
            if (projectIsError) void refetchProject()
          }}
        />
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
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-brand-text transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? t('untitled_project')}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-brand-text flex items-center gap-2">
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
              <span className="font-bold text-brand-text">
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
            { id: 'gantt', label: t('gantt_view', 'Gantt View') },
          ]}
          defaultTab="board"
        >
          {(activeTab) =>
            activeTab === 'board' ? (
              <div className="overflow-x-auto">
                <div className="flex min-w-fit gap-4">
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
                          <span className="ml-auto rounded-full bg-surface-bright px-2 py-0.5 text-xs font-bold text-brand-text">
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
                              {/* Per column, not per project */}
                              <p className="text-xs text-on-surface-muted/50">
                                {t('column_empty')}
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
              <LazyPanel
                fallback={
                  <div className="flex h-96 items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright">
                    <p className="text-sm text-on-surface-muted">{t('loading')}</p>
                  </div>
                }
              >
                <GanttView projectId={projectId} />
              </LazyPanel>
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

      {/* Revision points dialog */}
      {revisionDialogMilestone && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setRevisionDialogMilestone(null)
              setRevisionReason('')
            }}
            className="absolute inset-0 bg-black/50"
            aria-label={t('close')}
          />
          <div className="relative w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl border border-outline-dim/20">
            <h3 className="text-lg font-semibold text-brand-text mb-2">{t('request_revision')}</h3>
            <p className="text-sm text-on-surface-muted mb-4">{t('revision_reason_prompt')}</p>
            <label htmlFor="revision-reason" className="sr-only">
              {t('revision_reason_prompt')}
            </label>
            <textarea
              id="revision-reason"
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container p-3 text-sm text-on-surface placeholder:text-on-surface-subtle focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
              rows={4}
              placeholder={t('revision_reason_placeholder')}
            />
            <p className="mt-2 text-xs text-on-surface-muted">
              {t('revision_rounds_left', {
                used: revisionDialogMilestone.revisionCount,
                total: FREE_MILESTONE_REVISIONS,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRevisionDialogMilestone(null)
                  setRevisionReason('')
                }}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleRevisionConfirm}
                disabled={updateStatus.isPending || !revisionReason.trim()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                {updateStatus.isPending ? (
                  <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                ) : null}
                {t('confirm_revision')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
