import type { ApiResponse } from '@kerjacus/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Briefcase,
  CheckCircle,
  Clock,
  GraduationCap,
  Loader2,
  Shield,
  Sparkles,
  User,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirmMatching, useProject } from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/matching')({
  component: MatchingPage,
})

// The server strips userId and internal scores before this reaches the owner.
type ApiRecommendation = {
  talentId: string
  score: number
  skillMatch: number
  isExploration: boolean
}

type RawPosition = {
  workPackageId: string
  title: string
  requiredSkills: string[]
  recommendations: ApiRecommendation[]
}

type TalentProfile = {
  id: string
  yearsOfExperience: number | null
  educationUniversity: string | null
  educationMajor: string | null
  availabilityStatus: string
  domainExpertise: string[] | null
  totalProjectsCompleted: number
}

type TalentSkillRow = { skillName: string }

type Candidate = {
  talentId: string
  label: string
  score: number
  skillMatch: number
  isExploration: boolean
  experience: string
  completedProjects: number
  skills: string[]
  education: string
  domainExpertise: string[]
}

type Position = {
  workPackageId: string
  title: string
  requiredSkills: string[]
  label: string
  candidates: Candidate[]
}

// Fetch profile and skills for each unique talent once, keyed by talentId.
async function enrichTalents(
  talentIds: string[],
): Promise<Map<string, TalentProfile & { skills: string[] }>> {
  const map = new Map<string, TalentProfile & { skills: string[] }>()
  await Promise.all(
    talentIds.map(async (id) => {
      const [profileRes, skillsRes] = await Promise.all([
        fetch(apiUrl(`/api/v1/talents/${id}`), { credentials: 'include' }),
        fetch(apiUrl(`/api/v1/talents/${id}/skills`), { credentials: 'include' }),
      ])
      const profileJson: ApiResponse<TalentProfile> = profileRes.ok
        ? await profileRes.json()
        : { success: false }
      const skillsJson: ApiResponse<TalentSkillRow[]> = skillsRes.ok
        ? await skillsRes.json()
        : { success: false }
      const profile = profileJson.success ? profileJson.data : null
      const skillRows = skillsJson.success ? (skillsJson.data ?? []) : []
      if (profile) map.set(id, { ...profile, skills: skillRows.map((s) => s.skillName) })
    }),
  )
  return map
}

function useTeamPositions(projectId: string) {
  const { t } = useTranslation('matching')
  return useQuery({
    queryKey: ['team-positions', projectId],
    queryFn: async (): Promise<Position[]> => {
      const res = await fetch(apiUrl(`/api/v1/matching/${projectId}/positions`), {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('positions request failed')
      const json: ApiResponse<{ positions: RawPosition[] }> = await res.json()
      if (!json.success || !json.data) return []

      const raw = json.data.positions
      const talentIds = [...new Set(raw.flatMap((p) => p.recommendations.map((r) => r.talentId)))]
      const enriched = await enrichTalents(talentIds)

      return raw.map((p, pi) => ({
        workPackageId: p.workPackageId,
        title: p.title,
        requiredSkills: p.requiredSkills,
        label: t('position_label', { number: pi + 1 }),
        candidates: p.recommendations.flatMap((rec, ci): Candidate[] => {
          const profile = enriched.get(rec.talentId)
          if (!profile) return []
          return [
            {
              talentId: rec.talentId,
              label: t('talent_label', { number: ci + 1 }),
              score: rec.score,
              skillMatch: rec.skillMatch,
              isExploration: rec.isExploration,
              experience:
                profile.yearsOfExperience != null
                  ? t('years_short', { count: profile.yearsOfExperience })
                  : '-',
              completedProjects: profile.totalProjectsCompleted,
              skills: profile.skills,
              education:
                profile.educationMajor && profile.educationUniversity
                  ? `${profile.educationMajor} — ${profile.educationUniversity}`
                  : (profile.educationMajor ?? profile.educationUniversity ?? '-'),
              domainExpertise: profile.domainExpertise ?? [],
            },
          ]
        }),
      }))
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 30000,
  })
}

function MatchingPage() {
  const { t } = useTranslation('matching')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const confirmMatching = useConfirmMatching()

  const {
    data: positions = [],
    isLoading: positionsLoading,
    isError: positionsError,
  } = useTeamPositions(projectId)

  // One selected talent per work package.
  const [selections, setSelections] = useState<Record<string, string>>({})

  function selectTalent(workPackageId: string, talentId: string) {
    setSelections((prev) => {
      // Toggle off if the same talent is tapped again.
      if (prev[workPackageId] === talentId) {
        const { [workPackageId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [workPackageId]: talentId }
    })
  }

  const selectedTalentIds = new Set(Object.values(selections))
  const filledCount = Object.keys(selections).length
  const totalPositions = positions.length
  const allFilled = totalPositions > 0 && filledCount === totalPositions

  async function handleConfirm() {
    const assignments = Object.entries(selections).map(([workPackageId, talentId]) => ({
      workPackageId,
      talentId,
    }))
    await confirmMatching.mutateAsync({ projectId, assignments })
    navigate({ to: '/projects/$projectId', params: { projectId } })
  }

  if (projectLoading || positionsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary-600 tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-on-surface-muted">{t('subtitle')}</p>
        </div>

        {/* Team progress */}
        <div className="mb-6 rounded-xl bg-surface-bright p-4 border border-outline-dim/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-primary-600">{t('team_progress')}</h3>
            <span className="text-sm font-semibold text-primary-600">
              {t('positions_filled', { filled: filledCount, total: totalPositions })}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-container">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                allFilled ? 'bg-primary-600' : 'bg-primary-600/70',
              )}
              style={{
                width: `${totalPositions > 0 ? (filledCount / totalPositions) * 100 : 0}%`,
              }}
            />
          </div>
          {allFilled && (
            <p className="mt-2 text-xs font-medium text-success-600">{t('all_matched')}</p>
          )}
        </div>

        {/* Positions */}
        {positionsError ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface-bright border border-error-500/20 py-12">
            <XCircle className="mb-3 h-8 w-8 text-error-600" />
            <p className="text-sm font-medium text-error-600">{t('matching_error')}</p>
            <p className="mt-1 max-w-sm text-center text-xs text-on-surface-muted/70">
              {t('matching_error_description')}
            </p>
          </div>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface-bright border border-outline-dim/20 py-12">
            <User className="mb-3 h-8 w-8 text-on-surface-muted" />
            <p className="text-sm font-medium text-on-surface-muted">{t('no_recommendations')}</p>
            <p className="mt-1 max-w-sm text-center text-xs text-on-surface-muted/70">
              {t('no_recommendations_description')}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {positions.map((position) => (
              <PositionSection
                key={position.workPackageId}
                position={position}
                selectedTalentId={selections[position.workPackageId]}
                selectedTalentIds={selectedTalentIds}
                onSelect={(talentId) => selectTalent(position.workPackageId, talentId)}
              />
            ))}
          </div>
        )}

        {/* Confirm */}
        {allFilled && (
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmMatching.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-600/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {confirmMatching.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              {t('confirm_selection')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PositionSection({
  position,
  selectedTalentId,
  selectedTalentIds,
  onSelect,
}: {
  position: Position
  selectedTalentId: string | undefined
  selectedTalentIds: Set<string>
  onSelect: (talentId: string) => void
}) {
  const { t } = useTranslation('matching')

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-600/10 px-2.5 py-1 text-xs font-semibold text-primary-600 border border-primary-500/20">
          <Briefcase className="h-3 w-3" />
          {position.label}
        </span>
        <h2 className="text-sm font-semibold text-primary-600">{position.title}</h2>
      </div>
      {position.requiredSkills.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-on-surface-muted">{t('required_skills')}:</span>
          {position.requiredSkills.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-on-surface-muted border border-outline-dim/10"
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {position.candidates.length === 0 ? (
        <p className="rounded-lg bg-surface-bright border border-outline-dim/20 px-4 py-6 text-center text-xs text-on-surface-muted">
          {t('no_candidates')}
        </p>
      ) : (
        <div className="space-y-3">
          {position.candidates.map((candidate) => {
            const isSelected = selectedTalentId === candidate.talentId
            // Taken by another position -> not selectable here.
            const takenElsewhere = !isSelected && selectedTalentIds.has(candidate.talentId)
            return (
              <TalentCard
                key={candidate.talentId}
                candidate={candidate}
                isSelected={isSelected}
                takenElsewhere={takenElsewhere}
                onSelect={() => onSelect(candidate.talentId)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function TalentCard({
  candidate,
  isSelected,
  takenElsewhere,
  onSelect,
}: {
  candidate: Candidate
  isSelected: boolean
  takenElsewhere: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('matching')

  return (
    <div
      className={cn(
        'rounded-xl border p-5 transition-all',
        isSelected
          ? 'bg-surface-bright border-primary-500/50 ring-1 ring-primary-500/30'
          : takenElsewhere
            ? 'bg-surface-bright/50 border-outline-dim/20 opacity-50'
            : 'bg-surface-bright border-outline-dim/20',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container border border-outline-dim/20">
            <User className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-primary-600">{candidate.label}</h3>
              {candidate.isExploration && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-coral-500/15 px-2 py-0.5 text-xs font-medium text-accent-coral-600 border border-accent-coral-500/20">
                  <Sparkles className="h-3 w-3" />
                  {t('new_talent')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-on-surface-muted">
              <span className="flex items-center gap-1">
                <GraduationCap className="h-3 w-3" />
                {candidate.education}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {candidate.experience}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-success-600">
            {Math.round(candidate.score * 100)}%
          </div>
          <div className="text-xs text-on-surface-muted">{t('match')}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {candidate.skills.map((skill) => (
          <span
            key={skill}
            className="rounded-full bg-primary-600/10 border border-primary-500/20 px-2.5 py-0.5 text-xs font-medium text-success-600"
          >
            {skill}
          </span>
        ))}
      </div>

      {candidate.domainExpertise.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <Shield className="h-3 w-3 text-on-surface-muted" />
          <div className="flex flex-wrap gap-1.5">
            {candidate.domainExpertise.map((domain) => (
              <span key={domain} className="text-xs text-on-surface-muted">
                {domain}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-outline-dim/10 pt-4">
        {isSelected ? (
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-600/15 px-3 py-1 text-xs font-medium text-success-600 border border-primary-500/20">
              <CheckCircle className="h-3 w-3" />
              {t('selected')}
            </span>
            <button
              type="button"
              onClick={onSelect}
              className="text-xs font-medium text-on-surface-muted hover:text-primary-600 transition-colors"
            >
              {t('change')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            disabled={takenElsewhere}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle className="h-4 w-4" />
            {takenElsewhere ? t('taken_elsewhere') : t('select')}
          </button>
        )}
      </div>
    </div>
  )
}
