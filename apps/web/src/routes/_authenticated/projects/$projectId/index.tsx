import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Flag,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Star,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useProject,
  useProjectMilestones,
  useProjectReviews,
  useSubmitReview,
} from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/')({
  component: ProjectDetailPage,
})

const TABS = ['overview', 'milestones', 'chat', 'documents'] as const
type Tab = (typeof TABS)[number]

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  overview: <LayoutDashboard className="h-4 w-4" />,
  milestones: <Flag className="h-4 w-4" />,
  chat: <MessageSquare className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-neutral-500/10 text-on-surface-muted border border-outline-dim/20',
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
  on_hold: 'bg-neutral-500/10 text-on-surface-muted border border-outline-dim/20',
}

const CATEGORY_COLORS: Record<string, string> = {
  web_app: 'bg-primary-600/10 text-success-600 border border-success-500/20',
  mobile_app: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  ui_ux_design: 'bg-accent-cream-500/10 text-primary-600 border border-accent-cream-500/20',
  data_ai: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  other: 'bg-neutral-500/10 text-on-surface-muted border border-outline-dim/20',
}

const MILESTONE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-neutral-500/10 text-on-surface-muted',
  in_progress: 'bg-accent-cream-500/15 text-primary-600',
  submitted: 'bg-accent-cream-500/20 text-primary-600',
  revision_requested: 'bg-accent-coral-500/15 text-accent-coral-600',
  approved: 'bg-primary-600/15 text-success-600',
  rejected: 'bg-accent-coral-500/20 text-accent-coral-600',
}

function ProjectDetailPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const { data: project, isLoading } = useProject(projectId)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

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
        <Link to="/projects" className="mt-4 text-sm text-success-600 hover:underline">
          {t('my_projects')}
        </Link>
      </div>
    )
  }

  const displayProject = project

  const statusColor = STATUS_COLORS[displayProject.status] ?? STATUS_COLORS.draft
  const categoryColor = CATEGORY_COLORS[displayProject.category] ?? CATEGORY_COLORS.other

  return (
    <div className="bg-surface p-6 lg:p-8">
      {/* Breadcrumb / back */}
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('my_projects')}
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
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-outline-dim/20">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'border-success-500 text-success-600'
                  : 'border-transparent text-on-surface-muted hover:border-outline-dim/20 hover:text-primary-600/80',
              )}
            >
              {TAB_ICONS[tab]}
              {t(tab)}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab project={displayProject} />}
      {activeTab === 'milestones' && <MilestonesTab projectId={projectId} />}
      {activeTab === 'chat' && <ChatTab projectId={projectId} />}
      {activeTab === 'documents' && <DocumentsTab projectId={projectId} />}

      {/* Review section for completed/review projects */}
      {(displayProject.status === 'completed' || displayProject.status === 'review') && (
        <ReviewSection projectId={projectId} project={displayProject} />
      )}
    </div>
  )
}

function OverviewTab({
  project,
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
}) {
  const { t } = useTranslation('project')

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
              <p className="mt-0.5 text-lg font-bold text-primary-600">35%</p>
            </div>
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-success-600" />
              <p className="text-xs text-on-surface-muted">{t('milestones')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">1/6</p>
            </div>
            <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
              <Clock className="mx-auto mb-1.5 h-5 w-5 text-primary-600" />
              <p className="text-xs text-on-surface-muted">{t('days_remaining')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary-600">31</p>
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

function MilestonesTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')
  const { data: milestones, isLoading } = useProjectMilestones(projectId)

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((id) => (
          <div key={id} className="h-32 animate-pulse rounded-lg bg-surface-bright" />
        ))}
      </div>
    )
  }

  const displayMilestones = milestones ?? []

  if (displayMilestones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-12">
        <Flag className="mb-3 h-8 w-8 text-on-surface-muted" />
        <p className="text-sm font-medium text-on-surface-muted">{t('no_milestones')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {displayMilestones.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-4 rounded-xl bg-surface-bright p-4 border border-outline-dim/20"
        >
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              m.status === 'approved'
                ? 'bg-primary-600/15'
                : m.status === 'in_progress'
                  ? 'bg-accent-cream-500/15'
                  : 'bg-neutral-500/10',
            )}
          >
            {m.status === 'approved' ? (
              <CheckCircle2 className="h-5 w-5 text-success-600" />
            ) : m.status === 'in_progress' ? (
              <Activity className="h-5 w-5 text-primary-600" />
            ) : (
              <Clock className="h-5 w-5 text-on-surface-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-primary-600">{m.title}</h4>
            <p className="mt-0.5 text-xs text-on-surface-muted line-clamp-1">{m.description}</p>
          </div>
          <div className="text-right shrink-0">
            <span
              className={cn(
                'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
                MILESTONE_STATUS_COLORS[m.status] ?? MILESTONE_STATUS_COLORS.pending,
              )}
            >
              {t(m.status)}
            </span>
            {m.dueDate && (
              <p className="mt-1 text-xs text-on-surface-muted">{formatDate(m.dueDate)}</p>
            )}
          </div>
          <span className="shrink-0 text-sm font-semibold text-primary-600">
            {formatCurrency(m.amount)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ChatTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')

  return (
    <div className="flex flex-col items-center justify-center rounded-xl bg-surface-bright border border-outline-dim/20 py-12">
      <MessageSquare className="mb-3 h-8 w-8 text-on-surface-muted" />
      <p className="text-sm text-on-surface-muted">
        {t('chat')} - {t('coming_soon')}
      </p>
      <Link
        to="/projects/$projectId/scoping"
        params={{ projectId }}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600/90 transition-colors"
      >
        {t('go_to_scoping')}
      </Link>
    </div>
  )
}

function DocumentsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/projects/$projectId/brd"
          params={{ projectId }}
          className="flex items-center gap-4 rounded-xl bg-surface-bright p-5 border border-outline-dim/20 hover:border-primary-500/30 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent-coral-500/15">
            <FileText className="h-6 w-6 text-accent-coral-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-primary-600">{t('brd_title')}</h3>
            <p className="text-xs text-on-surface-muted">{t('brd_short')}</p>
          </div>
        </Link>
        <Link
          to="/projects/$projectId/prd"
          params={{ projectId }}
          className="flex items-center gap-4 rounded-xl bg-surface-bright p-5 border border-outline-dim/20 hover:border-primary-500/30 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600/15">
            <FileText className="h-6 w-6 text-success-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-primary-600">{t('prd_title')}</h3>
            <p className="text-xs text-on-surface-muted">{t('prd_short')}</p>
          </div>
        </Link>
      </div>
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

  // Determine revieweeId: for owner, it's the assigned talent; for talent, it's the project owner
  // We get the revieweeId from the project's clientId or the assignment
  const revieweeId =
    user.role === 'owner'
      ? (((project as Record<string, unknown>).talentId as string) ??
        ((project as Record<string, unknown>).assignedTalentId as string) ??
        '')
      : (((project as Record<string, unknown>).clientId as string) ??
        ((project as Record<string, unknown>).ownerId as string) ??
        '')

  async function handleSubmitReview() {
    if (rating === 0) {
      addToast('warning', t('review_rating_required'))
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
                          : 'text-neutral-300',
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
                        : 'text-neutral-300 hover:text-accent-cream-500/50',
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
