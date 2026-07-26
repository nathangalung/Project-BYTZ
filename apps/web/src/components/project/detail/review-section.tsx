import { CheckCircle2, Loader2, Star } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectReviews, useSubmitReview } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export function ReviewSection({
  projectId,
  project,
}: {
  projectId: string
  project: { status: string; [key: string]: unknown }
}) {
  const { t } = useTranslation('project')
  const { user } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
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
