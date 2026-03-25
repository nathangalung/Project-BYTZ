import type { ApiResponse } from '@kerjacus/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
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
import { useProject } from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/matching')({
  component: MatchingPage,
})

type TalentRecommendation = {
  id: string
  label: string
  score: number
  skillMatch: number
  experience: string
  completedProjects: number
  skills: string[]
  education: string
  isExploration: boolean
  workPackage: string | null
  domainExpertise: string[]
  availability: string
}

type MatchingApiRecommendation = {
  talentId: string
  userId: string
  score: number
  skillMatch: number
  pemerataanScore: number
  trackRecord: number
  rating: number
  isExploration: boolean
}

type MatchingApiResult = {
  recommendations: MatchingApiRecommendation[]
  explorationCount: number
  exploitationCount: number
}

function useMatchingRecommendations(projectId: string, requiredSkills: string[]) {
  return useQuery({
    queryKey: ['matching-recommendations', projectId],
    queryFn: async (): Promise<TalentRecommendation[]> => {
      const res = await fetch(apiUrl('/api/v1/matching/recommend'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requiredSkills: requiredSkills.length > 0 ? requiredSkills : ['general'],
        }),
      })
      if (!res.ok) return []
      const json: ApiResponse<MatchingApiResult> = await res.json()
      if (!json.success || !json.data) return []

      return json.data.recommendations.map(
        (rec: MatchingApiRecommendation, index: number): TalentRecommendation => ({
          id: rec.talentId,
          label: `Talenta #${index + 1}`,
          score: rec.score,
          skillMatch: rec.skillMatch,
          experience: '-',
          completedProjects: 0,
          skills: [],
          education: '-',
          isExploration: rec.isExploration,
          workPackage: null,
          domainExpertise: [],
          availability: '-',
        }),
      )
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 30000,
  })
}

function MatchingPage() {
  const { t } = useTranslation('matching')
  const { projectId } = Route.useParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)

  const requiredSkills: string[] =
    ((project?.preferences as Record<string, unknown> | null)?.required_skills as string[]) ?? []
  const {
    data: recommendations = [],
    isLoading: recommendationsLoading,
    isError: recommendationsError,
  } = useMatchingRecommendations(projectId, requiredSkills)
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({})

  function handleApprove(talentId: string) {
    setDecisions((prev) => ({ ...prev, [talentId]: 'approved' }))
  }

  function handleReject(talentId: string) {
    setDecisions((prev) => ({ ...prev, [talentId]: 'rejected' }))
  }

  const approvedCount = Object.values(decisions).filter((d) => d === 'approved').length
  const totalPositions = recommendations.length
  const allDecided = Object.keys(decisions).length === totalPositions

  if (projectLoading || recommendationsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary-600 tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-on-surface-muted">{t('subtitle')}</p>
        </div>

        {/* Team progress bar */}
        <div className="mb-6 rounded-xl bg-surface-bright p-4 border border-outline-dim/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-primary-600">{t('team_progress')}</h3>
            <span className="text-sm font-semibold text-primary-600">
              {t('positions_filled', {
                filled: approvedCount,
                total: totalPositions,
              })}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-container">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                approvedCount === totalPositions ? 'bg-primary-600' : 'bg-primary-600/70',
              )}
              style={{
                width: `${totalPositions > 0 ? (approvedCount / totalPositions) * 100 : 0}%`,
              }}
            />
          </div>
          {approvedCount === totalPositions && totalPositions > 0 && (
            <p className="mt-2 text-xs font-medium text-success-600">{t('all_matched')}</p>
          )}
        </div>

        {/* Recommendation cards */}
        {recommendationsError || recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface-bright border border-outline-dim/20 py-12">
            <User className="mb-3 h-8 w-8 text-on-surface-muted" />
            <p className="text-sm font-medium text-on-surface-muted">{t('no_recommendations')}</p>
            <p className="mt-1 max-w-sm text-center text-xs text-on-surface-muted/70">
              {t('no_recommendations_description')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((talent) => (
              <TalentCard
                key={talent.id}
                talent={talent}
                decision={decisions[talent.id]}
                onApprove={() => handleApprove(talent.id)}
                onReject={() => handleReject(talent.id)}
              />
            ))}
          </div>
        )}

        {/* Confirm button */}
        {allDecided && approvedCount > 0 && (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-600/90 transition-colors"
            >
              <CheckCircle className="h-4 w-4" />
              {t('confirm_selection')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TalentCard({
  talent,
  decision,
  onApprove,
  onReject,
}: {
  talent: TalentRecommendation
  decision: 'approved' | 'rejected' | undefined
  onApprove: () => void
  onReject: () => void
}) {
  const { t } = useTranslation('matching')

  return (
    <div
      className={cn(
        'rounded-xl border p-6 transition-all',
        decision === 'approved'
          ? 'bg-surface-bright border-primary-500/40'
          : decision === 'rejected'
            ? 'bg-surface-bright/60 border-outline-dim/20 opacity-60'
            : 'bg-surface-bright border-outline-dim/20',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container border border-outline-dim/20">
            <User className="h-6 w-6 text-primary-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-primary-600">{talent.label}</h3>
              {talent.isExploration && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-coral-500/15 px-2.5 py-0.5 text-xs font-medium text-accent-coral-600 border border-accent-coral-500/20">
                  <Sparkles className="h-3 w-3" />
                  {t('new_talent')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-on-surface-muted">
              <span className="flex items-center gap-1">
                <GraduationCap className="h-3 w-3" />
                {talent.education}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {talent.experience}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-success-600">
            {Math.round(talent.score * 100)}%
          </div>
          <div className="text-xs text-on-surface-muted">{t('match')}</div>
        </div>
      </div>

      {/* Work package label */}
      {talent.workPackage && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-container px-2.5 py-1 text-xs font-medium text-primary-600/80 border border-outline-dim/10">
            <Briefcase className="h-3 w-3 text-on-surface-muted" />
            {t('work_package')}: {talent.workPackage}
          </span>
        </div>
      )}

      {/* Skills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {talent.skills.map((skill) => (
          <span
            key={skill}
            className="rounded-full bg-primary-600/10 border border-primary-500/20 px-2.5 py-0.5 text-xs font-medium text-success-600"
          >
            {skill}
          </span>
        ))}
      </div>

      {/* Domain expertise */}
      <div className="mt-2 flex items-center gap-2">
        <Shield className="h-3 w-3 text-on-surface-muted" />
        <div className="flex flex-wrap gap-1.5">
          {talent.domainExpertise.map((domain) => (
            <span key={domain} className="text-xs text-on-surface-muted">
              {domain}
            </span>
          ))}
        </div>
      </div>

      {/* Score breakdown */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <ScoreBar label={t('skill_match')} value={talent.skillMatch} />
        <ScoreBar
          label={t('completed_projects')}
          value={Math.min(talent.completedProjects / 20, 1)}
          displayValue={String(talent.completedProjects)}
        />
      </div>

      {/* Action buttons or decision badge */}
      {!decision ? (
        <div className="mt-4 flex gap-2 border-t border-outline-dim/10 pt-4">
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            {t('approve')}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container hover:text-primary-600 transition-colors"
          >
            <XCircle className="h-4 w-4" />
            {t('request_other')}
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-outline-dim/10 pt-4">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              decision === 'approved'
                ? 'bg-primary-600/15 text-success-600 border border-primary-500/20'
                : 'bg-neutral-500/10 text-on-surface-muted border border-outline-dim/20',
            )}
          >
            {decision === 'approved' ? (
              <CheckCircle className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {decision === 'approved' ? t('approved') : t('rejected')}
          </span>
        </div>
      )}
    </div>
  )
}

function ScoreBar({
  label,
  value,
  displayValue,
}: {
  label: string
  value: number
  displayValue?: string
}) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-on-surface-muted">{label}</span>
        <span className="font-medium text-primary-600">
          {displayValue ?? `${Math.round(value * 100)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-container">
        <div
          className="h-2 rounded-full bg-primary-600 transition-all"
          style={{ width: `${Math.min(value * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}
