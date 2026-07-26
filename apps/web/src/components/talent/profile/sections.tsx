import type { TFunction } from 'i18next'
import { BarChart3, Briefcase, ExternalLink, GraduationCap, Star, Wrench } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  PLATFORM_ICONS,
  PROFICIENCY_COLORS,
  SKILL_CATEGORY_ORDER,
  type TalentProfile,
  useTalentRatings,
} from './shared'

export function SkillsSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const grouped = (profile.skills ?? []).reduce(
    (acc, skill) => {
      const cat = skill.category || 'other'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(skill)
      return acc
    },
    {} as Record<string, typeof profile.skills>,
  )

  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => SKILL_CATEGORY_ORDER.indexOf(a) - SKILL_CATEGORY_ORDER.indexOf(b),
  )

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <Wrench className="h-5 w-5 text-success-500" />
        <h2 className="text-base font-semibold text-primary-600">{t('skills')}</h2>
      </div>
      <div className="p-6">
        {sortedCategories.length === 0 ? (
          <p className="text-sm text-on-surface-muted">{t('no_skills')}</p>
        ) : (
          <div className="space-y-4">
            {sortedCategories.map((category) => (
              <div key={category}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                  {t(`category_${category}`, category)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {grouped[category].map((skill) => (
                    <span
                      key={skill.name}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium',
                        skill.isPrimary
                          ? 'border-success-500 bg-success-500/10 text-success-600'
                          : 'border-outline-dim/20 text-on-surface-muted',
                      )}
                    >
                      {skill.isPrimary && (
                        <Star className="h-3 w-3 fill-success-500 text-success-500" />
                      )}
                      {skill.name}
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          PROFICIENCY_COLORS[skill.proficiencyLevel] ??
                            'bg-surface-container text-on-surface-muted',
                        )}
                      >
                        {t(`level_${skill.proficiencyLevel}`, skill.proficiencyLevel)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PortfolioSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const links = profile.portfolioLinks ?? []

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <Briefcase className="h-5 w-5 text-primary-500" />
        <h2 className="text-base font-semibold text-primary-600">{t('portfolio')}</h2>
      </div>
      <div className="p-6">
        {links.length === 0 ? (
          <p className="text-sm text-on-surface-muted">{t('no_portfolio')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-outline-dim/20 p-3 transition-colors hover:bg-surface-bright"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container text-on-surface-muted">
                  {PLATFORM_ICONS[link.platform] ?? <ExternalLink className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary-600">{link.platform}</p>
                  <p className="truncate text-xs text-on-surface-muted">{link.url}</p>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-on-surface-muted" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function EducationSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  if (!profile.educationUniversity && !profile.educationMajor && !profile.educationYear) {
    return null
  }

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <GraduationCap className="h-5 w-5 text-warning-500" />
        <h2 className="text-base font-semibold text-primary-600">{t('education')}</h2>
      </div>
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-500/10">
            <GraduationCap className="h-5 w-5 text-warning-600" />
          </div>
          <div>
            {profile.educationUniversity && (
              <p className="text-sm font-semibold text-primary-600">
                {profile.educationUniversity}
              </p>
            )}
            {profile.educationMajor && (
              <p className="text-sm text-on-surface-muted">{profile.educationMajor}</p>
            )}
            {profile.educationYear && (
              <p className="text-xs text-on-surface-muted">
                {t('graduated')} {profile.educationYear}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RatingHistorySection({ t }: { t: TFunction }) {
  const { data: ratings, isLoading } = useTalentRatings()

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <BarChart3 className="h-5 w-5 text-accent-coral-500" />
        <h2 className="text-base font-semibold text-primary-600">{t('rating_history')}</h2>
        <span className="text-xs text-on-surface-muted">({t('internal_only')})</span>
      </div>
      <div className="p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`rating-skeleton-${String(i)}`} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : !ratings || ratings.length === 0 ? (
          <p className="text-sm text-on-surface-muted">{t('no_ratings')}</p>
        ) : (
          <div className="space-y-3">
            {ratings.map((review) => (
              <div
                key={review.id}
                className="rounded-lg border border-outline-dim/10 bg-surface-bright p-3"
              >
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={`star-${review.id}-${String(i)}`}
                        className={cn(
                          'h-3.5 w-3.5',
                          i < review.rating
                            ? 'fill-warning-500 text-warning-500'
                            : 'text-on-surface-muted',
                        )}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-on-surface-muted">
                    {new Intl.DateTimeFormat('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }).format(new Date(review.createdAt))}
                  </span>
                </div>
                {review.comment && (
                  <p className="mt-1.5 text-sm text-on-surface-muted">{review.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`stat-skeleton-${String(i)}`}
            className="rounded-xl border border-outline-dim/20 bg-surface-bright p-4"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={`skill-skeleton-${String(i)}`} className="h-8 w-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
