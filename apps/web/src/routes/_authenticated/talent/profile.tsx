import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import {
  BadgeCheck,
  BarChart3,
  Briefcase,
  CheckCircle,
  Clock,
  ExternalLink,
  Github,
  Globe,
  GraduationCap,
  Linkedin,
  Palette,
  Star,
  User,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Skeleton } from '@/components/ui/skeleton'
import { useTalentProfile as useTalentProfileHook } from '@/hooks/use-talent'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/talent/profile')({
  component: TalentProfilePage,
})

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

type TalentProfile = {
  id: string
  userId: string
  bio: string
  yearsOfExperience: number
  tier: 'junior' | 'mid' | 'senior'
  educationUniversity: string | null
  educationMajor: string | null
  educationYear: number | null
  cvFileUrl: string | null
  portfolioLinks: { platform: string; url: string }[]
  availabilityStatus: 'available' | 'busy' | 'unavailable'
  verificationStatus: 'unverified' | 'cv_parsing' | 'verified' | 'suspended'
  domainExpertise: string[]
  totalProjectsCompleted: number
  totalProjectsActive: number
  averageRating: number | null
  skills: {
    name: string
    category: string
    proficiencyLevel: string
    isPrimary: boolean
  }[]
}

type ReviewItem = {
  id: string
  projectId: string
  rating: number
  comment: string
  createdAt: string
}

function useTalentRatings() {
  return useQuery({
    queryKey: ['talent-ratings'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/talents/ratings`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load ratings')
      const data = await res.json()
      return (data.data ?? []) as ReviewItem[]
    },
  })
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  GitHub: <Github className="h-4 w-4" />,
  LinkedIn: <Linkedin className="h-4 w-4" />,
  Dribbble: <Palette className="h-4 w-4" />,
  Behance: <Palette className="h-4 w-4" />,
  Website: <Globe className="h-4 w-4" />,
}

const TIER_LABELS: Record<string, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
}

const TIER_COLORS: Record<string, string> = {
  junior: 'bg-accent-teal-500/10 text-accent-teal-600',
  mid: 'bg-primary-100 text-primary-700',
  senior: 'bg-accent-violet-500/10 text-accent-violet-600',
}

const VERIFICATION_COLORS: Record<string, string> = {
  verified: 'bg-success-500/10 text-success-600',
  cv_parsing: 'bg-warning-500/10 text-warning-600',
  unverified: 'bg-neutral-100 text-neutral-600',
  suspended: 'bg-error-500/10 text-error-600',
}

const PROFICIENCY_COLORS: Record<string, string> = {
  beginner: 'bg-neutral-100 text-neutral-600',
  intermediate: 'bg-primary-100 text-primary-700',
  advanced: 'bg-accent-teal-500/10 text-accent-teal-600',
  expert: 'bg-accent-violet-500/10 text-accent-violet-600',
}

const SKILL_CATEGORY_ORDER = ['frontend', 'backend', 'mobile', 'design', 'data', 'devops', 'other']

function TalentProfilePage() {
  const { t } = useTranslation('talent')

  return (
    <ErrorBoundary>
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <ProfileContent t={t} />
        </div>
      </div>
    </ErrorBoundary>
  )
}

function ProfileContent({ t }: { t: TFunction }) {
  const { user } = useAuthStore()
  const {
    data: profile,
    isLoading,
    isError,
  } = useTalentProfileHook(user?.id ?? '') as {
    data: TalentProfile | undefined
    isLoading: boolean
    isError: boolean
  }

  if (isLoading) {
    return <ProfileSkeleton />
  }

  if (isError || !profile) {
    return (
      <EmptyState
        icon={<User className="h-12 w-12 text-neutral-300" />}
        title={t('profile_not_found')}
        description={t('profile_not_found_description')}
      />
    )
  }

  return (
    <div className="space-y-6">
      <ProfileHeader user={user} profile={profile} t={t} />
      <StatsRow profile={profile} t={t} />
      <SkillsSection profile={profile} t={t} />
      <PortfolioSection profile={profile} t={t} />
      <EducationSection profile={profile} t={t} />
      <RatingHistorySection t={t} />
    </div>
  )
}

function ProfileHeader({
  user,
  profile,
  t,
}: {
  user: { name: string; avatarUrl?: string | null } | null
  profile: TalentProfile
  t: TFunction
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xl font-semibold text-primary-600">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user?.name ?? ''}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            (user?.name?.[0] ?? 'W').toUpperCase()
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-neutral-800">{user?.name}</h1>
            {profile.verificationStatus === 'verified' && (
              <BadgeCheck className="h-5 w-5 text-success-500" />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                TIER_COLORS[profile.tier] ?? 'bg-neutral-100 text-neutral-600',
              )}
            >
              {TIER_LABELS[profile.tier] ?? profile.tier}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                VERIFICATION_COLORS[profile.verificationStatus] ??
                  'bg-neutral-100 text-neutral-600',
              )}
            >
              {t(`verification_${profile.verificationStatus}`, profile.verificationStatus)}
            </span>
            <span className="text-xs text-neutral-500">
              {t('years_experience').replace('{{count}}', String(profile.yearsOfExperience))}
            </span>
          </div>
          {profile.bio && <p className="mt-3 text-sm text-neutral-600">{profile.bio}</p>}
        </div>
      </div>
    </div>
  )
}

function StatsRow({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const stats = [
    {
      icon: <CheckCircle className="h-5 w-5 text-success-500" />,
      label: t('completed_projects'),
      value: String(profile.totalProjectsCompleted),
    },
    {
      icon: <Star className="h-5 w-5 text-warning-500" />,
      label: t('avg_rating'),
      value: profile.averageRating != null ? profile.averageRating.toFixed(1) : '-',
    },
    {
      icon: <Clock className="h-5 w-5 text-primary-500" />,
      label: t('active_projects'),
      value: String(profile.totalProjectsActive),
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-neutral-100 p-2">{stat.icon}</div>
            <div>
              <p className="text-sm text-neutral-500">{stat.label}</p>
              <p className="text-xl font-semibold text-neutral-800">{stat.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillsSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
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
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-6 py-4">
        <Wrench className="h-5 w-5 text-accent-teal-500" />
        <h2 className="text-base font-semibold text-neutral-800">{t('skills')}</h2>
      </div>
      <div className="p-6">
        {sortedCategories.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('no_skills')}</p>
        ) : (
          <div className="space-y-4">
            {sortedCategories.map((category) => (
              <div key={category}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {t(`category_${category}`, category)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {grouped[category].map((skill) => (
                    <span
                      key={skill.name}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium',
                        skill.isPrimary
                          ? 'border-accent-teal-500 bg-accent-teal-500/10 text-accent-teal-600'
                          : 'border-neutral-200 text-neutral-700',
                      )}
                    >
                      {skill.isPrimary && (
                        <Star className="h-3 w-3 fill-accent-teal-500 text-accent-teal-500" />
                      )}
                      {skill.name}
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          PROFICIENCY_COLORS[skill.proficiencyLevel] ??
                            'bg-neutral-100 text-neutral-500',
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

function PortfolioSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const links = profile.portfolioLinks ?? []

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-6 py-4">
        <Briefcase className="h-5 w-5 text-primary-500" />
        <h2 className="text-base font-semibold text-neutral-800">{t('portfolio')}</h2>
      </div>
      <div className="p-6">
        {links.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('no_portfolio')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3 transition-colors hover:bg-neutral-50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                  {PLATFORM_ICONS[link.platform] ?? <ExternalLink className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-800">{link.platform}</p>
                  <p className="truncate text-xs text-neutral-500">{link.url}</p>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-neutral-400" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EducationSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  if (!profile.educationUniversity && !profile.educationMajor && !profile.educationYear) {
    return null
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-6 py-4">
        <GraduationCap className="h-5 w-5 text-warning-500" />
        <h2 className="text-base font-semibold text-neutral-800">{t('education')}</h2>
      </div>
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-500/10">
            <GraduationCap className="h-5 w-5 text-warning-600" />
          </div>
          <div>
            {profile.educationUniversity && (
              <p className="text-sm font-semibold text-neutral-800">
                {profile.educationUniversity}
              </p>
            )}
            {profile.educationMajor && (
              <p className="text-sm text-neutral-600">{profile.educationMajor}</p>
            )}
            {profile.educationYear && (
              <p className="text-xs text-neutral-400">
                {t('graduated')} {profile.educationYear}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RatingHistorySection({ t }: { t: TFunction }) {
  const { data: ratings, isLoading } = useTalentRatings()

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-6 py-4">
        <BarChart3 className="h-5 w-5 text-accent-violet-500" />
        <h2 className="text-base font-semibold text-neutral-800">{t('rating_history')}</h2>
        <span className="text-xs text-neutral-400">({t('internal_only')})</span>
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
          <p className="text-sm text-neutral-400">{t('no_ratings')}</p>
        ) : (
          <div className="space-y-3">
            {ratings.map((review) => (
              <div
                key={review.id}
                className="rounded-lg border border-neutral-100 bg-neutral-50 p-3"
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
                            : 'text-neutral-300',
                        )}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-neutral-400">
                    {new Intl.DateTimeFormat('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }).format(new Date(review.createdAt))}
                  </span>
                </div>
                {review.comment && (
                  <p className="mt-1.5 text-sm text-neutral-600">{review.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
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
            className="rounded-xl border border-neutral-200 bg-white p-4"
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
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
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
