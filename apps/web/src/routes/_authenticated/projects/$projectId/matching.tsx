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
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/matching')({
  component: MatchingPage,
})

type WorkerRecommendation = {
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

const MOCK_RECOMMENDATIONS: WorkerRecommendation[] = [
  {
    id: 'w1',
    label: 'Worker #1',
    score: 0.92,
    skillMatch: 0.95,
    experience: '6 years',
    completedProjects: 18,
    skills: ['React', 'TypeScript', 'Next.js', 'Tailwind CSS', 'Figma'],
    education: 'B.Sc. Computer Science',
    isExploration: false,
    workPackage: 'Frontend Development',
    domainExpertise: ['E-Commerce', 'SaaS', 'Fintech'],
    availability: 'Full-time',
  },
  {
    id: 'w2',
    label: 'Worker #2',
    score: 0.87,
    skillMatch: 0.89,
    experience: '4 years',
    completedProjects: 11,
    skills: ['Node.js', 'PostgreSQL', 'Redis', 'Docker', 'Hono'],
    education: 'B.Eng. Software Engineering',
    isExploration: false,
    workPackage: 'Backend API Development',
    domainExpertise: ['E-Commerce', 'Payment Systems'],
    availability: 'Full-time',
  },
  {
    id: 'w3',
    label: 'Worker #3',
    score: 0.78,
    skillMatch: 0.82,
    experience: '2 years',
    completedProjects: 0,
    skills: ['Figma', 'Adobe XD', 'Tailwind CSS', 'Framer Motion'],
    education: 'B.Des. Visual Communication',
    isExploration: true,
    workPackage: 'UI/UX Design',
    domainExpertise: ['E-Commerce', 'Branding'],
    availability: 'Full-time',
  },
  {
    id: 'w4',
    label: 'Worker #4',
    score: 0.74,
    skillMatch: 0.8,
    experience: '3 years',
    completedProjects: 5,
    skills: ['React', 'Vue.js', 'TypeScript', 'Node.js', 'MongoDB'],
    education: 'B.Sc. Information Systems',
    isExploration: false,
    workPackage: 'Frontend Development',
    domainExpertise: ['SaaS', 'Marketplace'],
    availability: 'Part-time',
  },
]

function MatchingPage() {
  const { t } = useTranslation('matching')
  const { projectId } = Route.useParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)

  const [recommendations] = useState<WorkerRecommendation[]>(MOCK_RECOMMENDATIONS)
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({})

  function handleApprove(workerId: string) {
    setDecisions((prev) => ({ ...prev, [workerId]: 'approved' }))
  }

  function handleReject(workerId: string) {
    setDecisions((prev) => ({ ...prev, [workerId]: 'rejected' }))
  }

  const approvedCount = Object.values(decisions).filter((d) => d === 'approved').length
  const totalPositions = recommendations.length
  const allDecided = Object.keys(decisions).length === totalPositions

  if (projectLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-[#152e34]">
        <Loader2 className="h-8 w-8 animate-spin text-[#9fc26e]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#152e34] p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-[#5e677d] hover:text-[#9fc26e] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#f6f3ab] tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-[#5e677d]">{t('subtitle')}</p>
        </div>

        {/* Team progress bar */}
        <div className="mb-6 rounded-xl bg-[#3b526a] p-4 border border-[#5e677d]/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#f6f3ab]">{t('team_progress')}</h3>
            <span className="text-sm font-semibold text-[#f6f3ab]">
              {t('positions_filled', {
                filled: approvedCount,
                total: totalPositions,
              })}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#112630]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                approvedCount === totalPositions ? 'bg-[#9fc26e]' : 'bg-[#9fc26e]/70',
              )}
              style={{
                width: `${totalPositions > 0 ? (approvedCount / totalPositions) * 100 : 0}%`,
              }}
            />
          </div>
          {approvedCount === totalPositions && totalPositions > 0 && (
            <p className="mt-2 text-xs font-medium text-[#9fc26e]">{t('all_matched')}</p>
          )}
        </div>

        {/* Recommendation cards */}
        {recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#3b526a] border border-[#5e677d]/20 py-12">
            <User className="mb-3 h-8 w-8 text-[#5e677d]" />
            <p className="text-sm font-medium text-[#5e677d]">{t('no_recommendations')}</p>
            <p className="mt-1 max-w-sm text-center text-xs text-[#5e677d]/70">
              {t('no_recommendations_description')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((worker) => (
              <WorkerCard
                key={worker.id}
                worker={worker}
                decision={decisions[worker.id]}
                onApprove={() => handleApprove(worker.id)}
                onReject={() => handleReject(worker.id)}
              />
            ))}
          </div>
        )}

        {/* Confirm button */}
        {allDecided && approvedCount > 0 && (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-[#9fc26e] px-6 py-2.5 text-sm font-semibold text-[#0d1e28] shadow-sm hover:bg-[#9fc26e]/90 transition-colors"
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

function WorkerCard({
  worker,
  decision,
  onApprove,
  onReject,
}: {
  worker: WorkerRecommendation
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
          ? 'bg-[#3b526a] border-[#9fc26e]/40'
          : decision === 'rejected'
            ? 'bg-[#3b526a]/60 border-[#5e677d]/20 opacity-60'
            : 'bg-[#3b526a] border-[#5e677d]/20',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#112630] border border-[#5e677d]/20">
            <User className="h-6 w-6 text-[#f6f3ab]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[#f6f3ab]">{worker.label}</h3>
              {worker.isExploration && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#e59a91]/15 px-2.5 py-0.5 text-xs font-medium text-[#e59a91] border border-[#e59a91]/20">
                  <Sparkles className="h-3 w-3" />
                  {t('new_talent')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-[#5e677d]">
              <span className="flex items-center gap-1">
                <GraduationCap className="h-3 w-3" />
                {worker.education}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {worker.experience}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[#9fc26e]">{Math.round(worker.score * 100)}%</div>
          <div className="text-xs text-[#5e677d]">{t('match')}</div>
        </div>
      </div>

      {/* Work package label */}
      {worker.workPackage && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#112630] px-2.5 py-1 text-xs font-medium text-[#f6f3ab]/80 border border-[#5e677d]/15">
            <Briefcase className="h-3 w-3 text-[#5e677d]" />
            {t('work_package')}: {worker.workPackage}
          </span>
        </div>
      )}

      {/* Skills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {worker.skills.map((skill) => (
          <span
            key={skill}
            className="rounded-full bg-[#9fc26e]/10 border border-[#9fc26e]/20 px-2.5 py-0.5 text-xs font-medium text-[#9fc26e]"
          >
            {skill}
          </span>
        ))}
      </div>

      {/* Domain expertise */}
      <div className="mt-2 flex items-center gap-2">
        <Shield className="h-3 w-3 text-[#5e677d]" />
        <div className="flex flex-wrap gap-1.5">
          {worker.domainExpertise.map((domain) => (
            <span key={domain} className="text-xs text-[#5e677d]">
              {domain}
            </span>
          ))}
        </div>
      </div>

      {/* Score breakdown */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <ScoreBar label={t('skill_match')} value={worker.skillMatch} />
        <ScoreBar
          label={t('completed_projects')}
          value={Math.min(worker.completedProjects / 20, 1)}
          displayValue={String(worker.completedProjects)}
        />
      </div>

      {/* Action buttons or decision badge */}
      {!decision ? (
        <div className="mt-4 flex gap-2 border-t border-[#5e677d]/15 pt-4">
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-semibold text-[#0d1e28] hover:bg-[#9fc26e]/90 transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            {t('approve')}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#5e677d]/40 px-4 py-2 text-sm font-medium text-[#5e677d] hover:bg-[#112630] hover:text-[#f6f3ab] transition-colors"
          >
            <XCircle className="h-4 w-4" />
            {t('request_other')}
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-[#5e677d]/15 pt-4">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              decision === 'approved'
                ? 'bg-[#9fc26e]/15 text-[#9fc26e] border border-[#9fc26e]/20'
                : 'bg-[#5e677d]/15 text-[#5e677d] border border-[#5e677d]/20',
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
        <span className="text-[#5e677d]">{label}</span>
        <span className="font-medium text-[#f6f3ab]">
          {displayValue ?? `${Math.round(value * 100)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-[#112630]">
        <div
          className="h-2 rounded-full bg-[#9fc26e] transition-all"
          style={{ width: `${Math.min(value * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}
