import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Flag,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Shield,
  Star,
  Tag,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCreateDispute,
  useProject,
  useProjectDisputes,
  useProjectMilestones,
  useProjectReviews,
  useSubmitReview,
  useTransitionProject,
  useUpdateProject,
} from '@/hooks/use-projects'
import { subscribeTo } from '@/lib/centrifugo'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/')({
  component: ProjectDetailPage,
})

// overview is this page; the rest are sibling routes that
// used to have no inbound link at all.
const TABS = ['overview', 'milestones', 'documents', 'time-tracking'] as const
type Tab = (typeof TABS)[number]

const TAB_ROUTES: Record<Exclude<Tab, 'overview'>, string> = {
  milestones: '/projects/$projectId/milestones',
  documents: '/projects/$projectId/documents',
  'time-tracking': '/projects/$projectId/time-tracking',
}

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  overview: <LayoutDashboard className="h-4 w-4" />,
  milestones: <Flag className="h-4 w-4" />,
  'time-tracking': <Clock className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-surface-container/40 text-on-surface-muted border border-outline-dim/20',
  scoping: 'bg-accent-cream-500/10 text-primary-600 border border-accent-cream-500/20',
  brd_generated: 'bg-accent-cream-500/15 text-primary-600 border border-accent-cream-500/30',
  brd_approved: 'bg-primary-600/10 text-success-600 border border-success-500/20',
  brd_purchased: 'bg-primary-600/15 text-success-600 border border-success-500/30',
  prd_generated: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  prd_approved: 'bg-accent-coral-500/15 text-accent-coral-600 border border-accent-coral-500/30',
  matching: 'bg-accent-cream-500/10 text-primary-600 border border-accent-cream-500/20',
  matched: 'bg-primary-600/10 text-success-600 border border-success-500/20',
  in_progress: 'bg-primary-600/15 text-success-600 border border-success-500/30',
  review: 'bg-accent-cream-500/15 text-primary-600 border border-accent-cream-500/30',
  completed: 'bg-primary-600/20 text-success-600 border border-success-500/40',
  cancelled: 'bg-accent-coral-500/15 text-accent-coral-600 border border-accent-coral-500/30',
  disputed: 'bg-accent-coral-500/20 text-accent-coral-600 border border-accent-coral-500/40',
  on_hold: 'bg-surface-container/40 text-on-surface-muted border border-outline-dim/20',
}

const CATEGORY_COLORS: Record<string, string> = {
  web_app: 'bg-primary-600/10 text-success-600 border border-success-500/20',
  mobile_app: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  ui_ux_design: 'bg-accent-cream-500/10 text-primary-600 border border-accent-cream-500/20',
  data_ai: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  other_digital: 'bg-surface-container/40 text-on-surface-muted border border-outline-dim/20',
}

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
  const { addToast } = useToastStore()
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

function OverviewTab({
  project,
  projectId,
}: {
  project: {
    description: string
    budgetMin: number
    budgetMax: number
    estimatedTimelineDays: number
    teamSize: number
    finalPrice: number | null
    createdAt: string
    updatedAt: string
  }
  projectId: string
}) {
  const { t } = useTranslation('project')
  const { data: milestones = [] } = useProjectMilestones(projectId)

  const approvedCount = milestones.filter((m) => m.status === 'approved').length
  const totalCount = milestones.length
  const progressPercent = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0
  const elapsedDays = Math.floor(
    (Date.now() - new Date(project.createdAt).getTime()) / (1000 * 60 * 60 * 24),
  )
  const daysRemaining = Math.max(0, project.estimatedTimelineDays - elapsedDays)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-xl bg-surface-bright p-6 border border-outline-dim/20">
          <h3 className="mb-3 text-sm font-semibold text-primary-600">{t('description')}</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface-muted">
            {project.description}
          </p>
        </div>

        {/* Progress summary */}
        <div className="rounded-xl bg-surface-bright p-6 border border-outline-dim/20">
          <h3 className="mb-4 text-sm font-semibold text-primary-600 flex items-center gap-2">
            <Activity className="h-4 w-4 text-success-600" />
            {t('overview')}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <TrendingUp className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
              <p className="text-xs text-on-surface-muted">{t('overall_progress')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">{progressPercent}%</p>
            </div>
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
              <p className="text-xs text-on-surface-muted">{t('milestones')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">
                {approvedCount}/{totalCount}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <Clock className="mx-auto mb-1.5 h-5 w-5 text-primary-600" />
              <p className="text-xs text-on-surface-muted">{t('days_remaining')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">{daysRemaining}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
          <h3 className="mb-4 text-sm font-semibold text-primary-600">
            {t('budget')} & {t('timeline')}
          </h3>
          <div className="space-y-3">
            <InfoRow
              icon={<Wallet className="h-4 w-4 text-on-surface-muted" />}
              label={t('budget')}
              value={`${formatCurrency(project.budgetMin)} - ${formatCurrency(project.budgetMax)}`}
            />
            <InfoRow
              icon={<Clock className="h-4 w-4 text-on-surface-muted" />}
              label={t('estimated_timeline')}
              value={`${project.estimatedTimelineDays} ${t('days')}`}
            />
            <InfoRow
              icon={<Users className="h-4 w-4 text-on-surface-muted" />}
              label={t('team_size')}
              value={String(project.teamSize)}
            />
            {project.finalPrice && (
              <InfoRow
                icon={<Wallet className="h-4 w-4 text-success-600" />}
                label={t('final_price')}
                value={formatCurrency(project.finalPrice)}
                highlight
              />
            )}
          </div>
        </div>

        <div className="rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
          <h3 className="mb-4 text-sm font-semibold text-primary-600">{t('key_dates')}</h3>
          <div className="space-y-3">
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-on-surface-muted" />}
              label={t('created_at')}
              value={formatDate(project.createdAt)}
            />
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-on-surface-muted" />}
              label={t('updated_at')}
              value={formatDate(project.updatedAt)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-xs text-on-surface-muted">{label}</span>
      <span
        className={cn(
          'ml-auto text-sm font-medium',
          highlight ? 'text-success-600' : 'text-primary-600',
        )}
      >
        {value}
      </span>
    </div>
  )
}

const DISPUTE_STATUS_COLORS: Record<string, string> = {
  open: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  under_review: 'bg-accent-cream-500/10 text-primary-600 border border-accent-cream-500/20',
  mediation: 'bg-accent-cream-500/15 text-primary-600 border border-accent-cream-500/30',
  escalated: 'bg-accent-coral-500/20 text-accent-coral-600 border border-accent-coral-500/40',
  resolved: 'bg-primary-600/10 text-success-600 border border-success-500/20',
}

const RESOLUTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  funds_to_talent: <TrendingUp className="h-4 w-4 text-success-600" />,
  funds_to_owner: <Wallet className="h-4 w-4 text-accent-coral-600" />,
  split: <Users className="h-4 w-4 text-primary-600" />,
}

function DisputeSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')
  const { data: disputes = [], isLoading } = useProjectDisputes(projectId)

  if (isLoading) {
    return (
      <div className="mt-8 rounded-xl bg-surface-bright p-6 border border-error-500/30">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 rounded-xl bg-surface-bright p-6 border border-error-500/30">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-accent-coral-600">
        <AlertTriangle className="h-5 w-5" />
        {t('dispute_section_title')}
      </h3>

      {disputes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <Shield className="mb-3 h-8 w-8 text-on-surface-muted" />
          <p className="text-sm text-on-surface-muted">{t('no_disputes')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className="rounded-lg border border-error-500/20 bg-error-500/5 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        DISPUTE_STATUS_COLORS[dispute.status] ?? DISPUTE_STATUS_COLORS.open,
                      )}
                    >
                      {t(`dispute_status_${dispute.status}`)}
                    </span>
                    <span className="text-xs text-on-surface-muted">
                      {formatDate(dispute.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-on-surface leading-relaxed">{dispute.reason}</p>

                  {dispute.evidenceUrls && dispute.evidenceUrls.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-on-surface-muted">
                        {t('dispute_evidence')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {dispute.evidenceUrls.map((url, i) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-surface-container px-2.5 py-1 text-xs text-primary-600 hover:underline"
                          >
                            <FileText className="h-3 w-3" />
                            {t('evidence_item', { n: i + 1 })}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {dispute.status === 'resolved' && dispute.resolution && (
                    <div className="mt-3 rounded-md bg-success-500/10 border border-success-500/20 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        {dispute.resolutionType && RESOLUTION_TYPE_ICONS[dispute.resolutionType]}
                        <span className="text-xs font-medium text-success-600">
                          {t(`resolution_type_${dispute.resolutionType ?? 'split'}`)}
                        </span>
                        {dispute.resolvedAt && (
                          <span className="text-xs text-on-surface-muted">
                            · {formatDate(dispute.resolvedAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-on-surface-muted">{dispute.resolution}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewSection({
  projectId,
  project,
}: {
  projectId: string
  project: { status: string; [key: string]: unknown }
}) {
  const { t } = useTranslation('project')
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const { data: existingReviews, isLoading: reviewsLoading } = useProjectReviews(projectId)
  const submitReview = useSubmitReview()

  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')

  if (!user) return null

  const reviewType: 'owner_to_talent' | 'talent_to_owner' =
    user.role === 'owner' ? 'owner_to_talent' : 'talent_to_owner'

  const hasAlreadyReviewed = (existingReviews ?? []).some(
    (r) => r.reviewerId === user.id && r.type === reviewType,
  )

  // The owner reviews the assigned talent (their user id, exposed by GET /:id
  // for participants); the talent reviews the project owner.
  const projectTeam = project as {
    assignments?: { talentUserId: string }[]
    ownerId?: string
  }
  const revieweeId =
    user.role === 'owner'
      ? (projectTeam.assignments?.[0]?.talentUserId ?? '')
      : (projectTeam.ownerId ?? '')

  async function handleSubmitReview() {
    if (rating === 0) {
      addToast('warning', t('review_rating_required'))
      return
    }
    if (!revieweeId) {
      addToast('error', t('review_submit_failed'))
      return
    }

    try {
      await submitReview.mutateAsync({
        projectId,
        revieweeId,
        rating,
        comment: comment.trim() || undefined,
        type: reviewType,
      })
      addToast('success', t('review_submitted'))
      setRating(0)
      setComment('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('review_submit_failed')
      addToast('error', msg)
    }
  }

  if (reviewsLoading) {
    return (
      <div className="mt-8 rounded-xl bg-surface-bright p-6 border border-outline-dim/20">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 rounded-xl bg-surface-bright p-6 border border-outline-dim/20">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary-600">
        <Star className="h-5 w-5 text-accent-cream-600" />
        {t('review_section_title')}
      </h3>

      {hasAlreadyReviewed ? (
        <div className="rounded-lg bg-success-500/10 border border-success-500/20 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success-600" />
            <p className="text-sm font-medium text-success-600">{t('review_already_submitted')}</p>
          </div>
          {(() => {
            const myReview = (existingReviews ?? []).find(
              (r) => r.reviewerId === user.id && r.type === reviewType,
            )
            if (!myReview) return null
            return (
              <div className="mt-3 pl-7">
                <div className="flex items-center gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={cn(
                        'h-4 w-4',
                        star <= myReview.rating
                          ? 'fill-accent-cream-600 text-accent-cream-600'
                          : 'text-on-surface-muted',
                      )}
                    />
                  ))}
                </div>
                {myReview.comment && (
                  <p className="text-sm text-on-surface-muted">{myReview.comment}</p>
                )}
              </div>
            )
          })()}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Star rating */}
          <div>
            <label
              htmlFor="review-rating"
              className="mb-2 block text-sm font-medium text-on-surface"
            >
              {t('rating_label')}
            </label>
            <div id="review-rating" className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-0.5 transition-transform hover:scale-110"
                  aria-label={`${star} ${t('stars')}`}
                >
                  <Star
                    className={cn(
                      'h-7 w-7 transition-colors',
                      star <= (hoverRating || rating)
                        ? 'fill-accent-cream-600 text-accent-cream-600'
                        : 'text-on-surface-muted hover:text-accent-cream-500/50',
                    )}
                  />
                </button>
              ))}
              {rating > 0 && (
                <span className="ml-2 text-sm font-medium text-primary-600">{rating}/5</span>
              )}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label
              htmlFor="review-comment"
              className="mb-2 block text-sm font-medium text-on-surface"
            >
              {t('review_comment_label')}
            </label>
            <textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container p-3 text-sm text-on-surface placeholder:text-on-surface-muted/50 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              rows={4}
              maxLength={2000}
              placeholder={t('review_comment_placeholder')}
            />
            <p className="mt-1 text-xs text-on-surface-muted text-right">{comment.length}/2000</p>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmitReview}
            disabled={rating === 0 || submitReview.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors disabled:opacity-50"
          >
            {submitReview.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className="h-4 w-4" />
            )}
            {t('submit_review')}
          </button>
        </div>
      )}
    </div>
  )
}
