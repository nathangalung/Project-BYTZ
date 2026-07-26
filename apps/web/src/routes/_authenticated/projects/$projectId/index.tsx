import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Flag,
  Loader2,
  MessageSquare,
  Tag,
  Users,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DisputeSection } from '@/components/project/detail/dispute-section'
import { OverviewTab } from '@/components/project/detail/overview-tab'
import { ReviewSection } from '@/components/project/detail/review-section'
import {
  CATEGORY_COLORS,
  STATUS_COLORS,
  TAB_ICONS,
  TAB_ROUTES,
  TABS,
} from '@/components/project/detail/shared'
import { MatchingSlaBanner } from '@/components/project/matching-sla-banner'
import {
  useCreateDispute,
  useProject,
  useTransitionProject,
  useUpdateProject,
} from '@/hooks/use-projects'
import { subscribeTo } from '@/lib/centrifugo'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/')({
  component: ProjectDetailPage,
})

// overview is this page; the rest are sibling routes that
// used to have no inbound link at all.

function ProjectDetailPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()
  // Talent has no owner project list.
  const role = useAuthStore((s) => s.user?.role)
  const isOwner = role !== 'talent'
  const { data: project, isLoading } = useProject(projectId)
  const transitionProject = useTransitionProject()
  const updateProject = useUpdateProject()
  const createDispute = useCreateDispute()
  const addToast = useToastStore((s) => s.addToast)
  // Shared modal for the two owner danger actions.
  const [dangerMode, setDangerMode] = useState<'cancel' | 'dispute' | null>(null)
  const [dangerReason, setDangerReason] = useState('')

  async function handleTransition(status: 'in_progress' | 'completed' | 'cancelled') {
    try {
      await transitionProject.mutateAsync({ projectId, status })
      addToast('success', t(`status_${status}`))
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('something_wrong', { ns: 'common' }))
    }
  }

  const CANCELLABLE = new Set([
    'draft',
    'scoping',
    'brd_generated',
    'brd_approved',
    'prd_generated',
    'prd_approved',
    'matching',
    'team_forming',
    'matched',
    'in_progress',
    'partially_active',
    'on_hold',
  ])
  const DISPUTABLE = new Set(['in_progress', 'partially_active', 'review', 'on_hold'])

  async function handleDangerSubmit() {
    if (dangerMode === 'dispute' && !dangerReason.trim()) {
      addToast('warning', t('dispute_reason_required'))
      return
    }
    try {
      if (dangerMode === 'cancel') {
        await transitionProject.mutateAsync({ projectId, status: 'cancelled' })
        addToast('success', t('status_cancelled'))
      } else if (dangerMode === 'dispute') {
        const againstUserId =
          (project as { assignments?: { talentUserId: string }[] }).assignments?.[0]
            ?.talentUserId ?? ''
        if (!againstUserId) {
          addToast('error', t('dispute_no_talent'))
          return
        }
        await createDispute.mutateAsync({
          projectId,
          againstUserId,
          reason: dangerReason.trim(),
        })
        addToast('success', t('dispute_opened'))
      }
      setDangerMode(null)
      setDangerReason('')
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('something_wrong', { ns: 'common' }))
    }
  }

  // Subscribe to real-time project status updates.
  useEffect(() => {
    if (!projectId) return
    const unsubscribe = subscribeTo(`project:${projectId}`, () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    })
    return unsubscribe
  }, [projectId, queryClient])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 bg-surface">
        <Flag className="mb-3 h-10 w-10 text-on-surface-muted" />
        <h2 className="text-lg font-semibold text-primary-600">{t('project_not_found')}</h2>
        <Link
          to={role === 'talent' ? '/talent' : '/projects'}
          className="mt-4 text-sm text-success-600 hover:underline"
        >
          {t('back')}
        </Link>
      </div>
    )
  }

  const displayProject = project

  const statusColor = STATUS_COLORS[displayProject.status] ?? STATUS_COLORS.draft
  const categoryColor = CATEGORY_COLORS[displayProject.category] ?? CATEGORY_COLORS.other_digital

  return (
    <div className="bg-surface p-6 lg:p-8">
      {/* Breadcrumb / back */}
      <Link
        to={role === 'talent' ? '/talent' : '/projects'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('back')}
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary-600 tracking-tight">
            {displayProject.title}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', categoryColor)}>
              <Tag className="mr-1 inline h-3 w-3" />
              {t(displayProject.category)}
            </span>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', statusColor)}>
              {t(`status_${displayProject.status}`)}
            </span>
            {/* Visibility was locked to its creation value; owners can now change it. */}
            {isOwner && (
              <select
                value={(displayProject as { visibility?: string }).visibility ?? 'public_summary'}
                onChange={(e) =>
                  updateProject.mutate({
                    projectId,
                    visibility: e.target.value as 'private' | 'public_summary' | 'public_detail',
                  })
                }
                disabled={updateProject.isPending}
                className="rounded-full border border-outline-dim/20 bg-surface-bright px-2.5 py-1 text-xs font-medium text-on-surface-muted focus:border-primary-500 focus:outline-none disabled:opacity-50"
              >
                <option value="private">{t('vis_private')}</option>
                <option value="public_summary">{t('vis_public_summary')}</option>
                <option value="public_detail">{t('vis_public_full')}</option>
              </select>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {(displayProject.status === 'draft' || displayProject.status === 'scoping') && (
            <Link
              to="/projects/$projectId/scoping"
              params={{ projectId }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600/90 transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              {t('scoping_title')}
            </Link>
          )}
          {(displayProject.status === 'brd_generated' ||
            displayProject.status === 'brd_approved') && (
            <Link
              to="/projects/$projectId/brd"
              params={{ projectId }}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-coral-500/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              {t('brd_title')}
            </Link>
          )}
          {(displayProject.status === 'prd_generated' ||
            displayProject.status === 'prd_approved') && (
            <Link
              to="/projects/$projectId/prd"
              params={{ projectId }}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-coral-500/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              {t('prd_title')}
            </Link>
          )}
          {(displayProject.status === 'matching' || displayProject.status === 'team_forming') && (
            <Link
              to="/projects/$projectId/matching"
              params={{ projectId }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600/90 transition-colors"
            >
              <Users className="h-4 w-4" />
              {t('view_matching')}
            </Link>
          )}
          {/* Matched is not a dead end: the owner starts execution here. */}
          {isOwner && displayProject.status === 'matched' && (
            <button
              type="button"
              onClick={() => handleTransition('in_progress')}
              disabled={transitionProject.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600/90 disabled:opacity-50 transition-colors"
            >
              {transitionProject.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Flag className="h-4 w-4" />
              )}
              {t('start_project_cta')}
            </button>
          )}
          {/* Final acceptance: review -> completed is the owner's call. */}
          {isOwner && displayProject.status === 'review' && (
            <button
              type="button"
              onClick={() => handleTransition('completed')}
              disabled={transitionProject.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-success-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-success-600/90 disabled:opacity-50 transition-colors"
            >
              {transitionProject.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Flag className="h-4 w-4" />
              )}
              {t('mark_complete_cta')}
            </button>
          )}
          {isOwner && CANCELLABLE.has(displayProject.status) && (
            <button
              type="button"
              onClick={() => setDangerMode('cancel')}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 px-4 py-2.5 text-sm font-medium text-accent-coral-600 hover:bg-accent-coral-500/5 transition-colors"
            >
              <XCircle className="h-4 w-4" />
              {t('cancel_project')}
            </button>
          )}
          {isOwner && DISPUTABLE.has(displayProject.status) && (
            <button
              type="button"
              onClick={() => setDangerMode('dispute')}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 px-4 py-2.5 text-sm font-medium text-accent-coral-600 hover:bg-accent-coral-500/5 transition-colors"
            >
              <AlertTriangle className="h-4 w-4" />
              {t('open_dispute')}
            </button>
          )}
        </div>
      </div>

      <MatchingSlaBanner
        projectId={projectId}
        status={displayProject.status}
        teamSize={displayProject.teamSize ?? 1}
      />

      {/* Owner danger actions: cancel the project or open a dispute. */}
      {dangerMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-bright p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-primary-600">
              {dangerMode === 'cancel' ? t('cancel_project') : t('open_dispute')}
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">
              {dangerMode === 'cancel' ? t('cancel_project_desc') : t('open_dispute_desc')}
            </p>
            {dangerMode === 'dispute' && (
              <textarea
                rows={4}
                value={dangerReason}
                onChange={(e) => setDangerReason(e.target.value)}
                placeholder={t('dispute_reason_placeholder')}
                className="mt-4 w-full resize-none rounded-lg border border-outline-dim/20 px-3 py-2.5 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDangerMode(null)
                  setDangerReason('')
                }}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-surface-container"
              >
                {t('cancel', { ns: 'common' })}
              </button>
              <button
                type="button"
                onClick={handleDangerSubmit}
                disabled={transitionProject.isPending || createDispute.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral-500/90 disabled:opacity-50"
              >
                {transitionProject.isPending || createDispute.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {dangerMode === 'cancel' ? t('confirm_cancel') : t('submit_dispute')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 border-b border-outline-dim/20">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {TABS.map((tab) =>
            tab === 'overview' ? (
              <span
                key={tab}
                className="inline-flex items-center gap-2 border-b-2 border-success-500 pb-3 text-sm font-medium text-success-600"
              >
                {TAB_ICONS[tab]}
                {t(tab)}
              </span>
            ) : (
              <Link
                key={tab}
                to={TAB_ROUTES[tab]}
                params={{ projectId }}
                className="inline-flex items-center gap-2 border-b-2 border-transparent pb-3 text-sm font-medium text-on-surface-muted transition-colors hover:border-outline-dim/20 hover:text-primary-600/80"
              >
                {TAB_ICONS[tab]}
                {t(tab)}
              </Link>
            ),
          )}
        </nav>
      </div>

      {/* Tab content */}
      <OverviewTab project={displayProject} projectId={projectId} />

      {/* Review section for completed/review projects */}
      {(displayProject.status === 'completed' || displayProject.status === 'review') && (
        <ReviewSection projectId={projectId} project={displayProject} />
      )}

      {/* Dispute section when project is disputed */}
      {displayProject.status === 'disputed' && <DisputeSection projectId={projectId} />}
    </div>
  )
}
