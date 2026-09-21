import type { TFunction } from 'i18next'
import {
  BarChart3,
  Briefcase,
  ExternalLink,
  FolderGit2,
  GraduationCap,
  Star,
  Target,
  Wrench,
} from 'lucide-react'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  PLATFORM_ICONS,
  PROFICIENCY_COLORS,
  SKILL_CATEGORY_ORDER,
  type TalentEducationEntry,
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
        <h2 className="text-base font-semibold text-brand-text">{t('skills')}</h2>
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
        <Briefcase className="h-5 w-5 text-brand-accent" />
        <h2 className="text-base font-semibold text-brand-text">{t('portfolio')}</h2>
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
                  <p className="text-sm font-medium text-brand-text">{link.platform}</p>
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

export function DomainExpertiseSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const domains = profile.domainExpertise ?? []

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <Target className="h-5 w-5 text-brand-accent" />
        <h2 className="text-base font-semibold text-brand-text">{t('domain_expertise')}</h2>
      </div>
      <div className="p-6">
        {domains.length === 0 ? (
          <p className="text-sm text-on-surface-muted">{t('no_domain_expertise')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {domains.map((domain) => (
              <span
                key={domain}
                className="rounded-full bg-surface-container px-3 py-1 text-sm text-on-surface-muted"
              >
                {domain}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** "2017 - 2021", "- 2021", or nothing at all when the CV gave no dates. */
function studyPeriod(entry: TalentEducationEntry): string {
  if (entry.startYear && entry.endYear) return `${entry.startYear} - ${entry.endYear}`
  return String(entry.endYear ?? entry.startYear ?? '')
}

/**
 * Every degree the CV parse found, most recent first.
 *
 * This used to render the three flat columns on the profile, which hold one
 * university and one major: an S1 plus an S2 showed as a single line, and the
 * qualification and the grade were nowhere. The rows come from
 * talent_education now. The flat columns remain the fallback for a talent who
 * typed their education into the form and never uploaded a CV.
 *
 * Which is also the open edge: the edit form still writes those columns, so a
 * talent who corrects a mis-parsed university sees no change while a row
 * exists. Pointing that form at talent_education is the follow-up.
 */
export function EducationSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const entries = profile.education ?? []

  if (entries.length === 0) {
    if (!profile.educationUniversity && !profile.educationMajor && !profile.educationYear) {
      return null
    }
    return (
      <EducationCard t={t}>
        <EducationRow
          t={t}
          university={profile.educationUniversity}
          major={profile.educationMajor}
          period={profile.educationYear ? String(profile.educationYear) : ''}
        />
      </EducationCard>
    )
  }

  return (
    <EducationCard t={t}>
      <div className="space-y-5">
        {entries.map((entry) => (
          <EducationRow
            key={entry.id}
            t={t}
            university={entry.university}
            major={entry.major}
            degree={entry.degree}
            gpa={entry.gpa}
            period={studyPeriod(entry)}
          />
        ))}
      </div>
    </EducationCard>
  )
}

function EducationCard({ t, children }: { t: TFunction; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <GraduationCap className="h-5 w-5 text-warning-500" />
        <h2 className="text-base font-semibold text-brand-text">{t('education')}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function EducationRow({
  t,
  university,
  major,
  degree,
  gpa,
  period,
}: {
  t: TFunction
  university: string | null
  major: string | null
  degree?: string | null
  gpa?: string | null
  period: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-500/10">
        <GraduationCap className="h-5 w-5 text-warning-600" />
      </div>
      <div className="min-w-0">
        {university && <p className="text-sm font-semibold text-brand-text">{university}</p>}
        {(degree || major) && (
          <p className="text-sm text-on-surface-muted">
            {[degree, major].filter(Boolean).join(' - ')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-on-surface-muted">
          {period && (
            <span>
              {t('graduated')} {period}
            </span>
          )}
          {gpa && <span>{t('gpa_label', { gpa })}</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * What the talent has built, from talent_projects.
 *
 * Registration used to keep only the repository URL and throw away the title,
 * the description and the tech stack, so the one part of a CV that shows
 * competence never reached a screen. A client sees the same list without the
 * URL - that link carries the real name, which anonymity before a deal holds
 * back - so this section is the talent's own full view of it.
 */
export function ProjectsSection({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const projects = profile.projects ?? []

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <FolderGit2 className="h-5 w-5 text-brand-accent" />
        <h2 className="text-base font-semibold text-brand-text">{t('projects')}</h2>
      </div>
      <div className="p-6">
        {projects.length === 0 ? (
          <p className="text-sm text-on-surface-muted">{t('no_projects')}</p>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="rounded-lg border border-outline-dim/20 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-brand-text">{project.title}</p>
                  {project.url && (
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex shrink-0 items-center gap-1 text-xs text-brand-accent hover:underline"
                    >
                      {t('open_project')}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {project.description && (
                  <p className="text-sm text-on-surface-muted">{project.description}</p>
                )}
                {project.techStack && project.techStack.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {project.techStack.map((tech) => (
                      <span
                        key={tech}
                        className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs text-on-surface-muted"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function RatingHistorySection({ t }: { t: TFunction }) {
  const { data: ratings, isLoading, isError, refetch } = useTalentRatings()

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        <BarChart3 className="h-5 w-5 text-accent-coral-500" />
        <h2 className="text-base font-semibold text-brand-text">{t('rating_history')}</h2>
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
        ) : isError ? (
          // An unread history is not an empty one.
          <QueryError message={t('ratings_load_failed')} onRetry={() => void refetch()} />
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
