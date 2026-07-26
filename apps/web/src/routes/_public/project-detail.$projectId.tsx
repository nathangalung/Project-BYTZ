import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle, Clock, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApplyToProject, useTalentProfile } from '@/hooks/use-talent'
import { apiUrl } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_public/project-detail/$projectId')({
  component: PublicProjectDetailPage,
})

/**
 * The shape GET /projects/:id serves for a public_detail project. It is a
 * projection of the PRD, not the PRD: the backend leaves every money field
 * behind, so there is nothing here to hide at render time.
 */
type PublicScope = {
  architecture: string
  techStack: { name: string; category: string; description: string }[]
  workPackages: {
    name: string
    requiredSkills: string[]
    estimatedHours: number
    deliverables: { title: string; type: string }[]
    acceptanceCriteria: string[]
  }[]
  sprintPlan: { name: string; duration: string; milestones: string[] }[]
  assumptions: string[]
  risks: string[]
  totalEstimatedHours: number
}

function ProjectScope({ scope }: { scope: PublicScope }) {
  const { t } = useTranslation('project')
  const card = 'mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6'
  const heading = 'text-sm font-semibold text-primary-600'
  const chip =
    'rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-medium text-on-surface-muted'

  return (
    <>
      {scope.architecture && (
        <div className={card}>
          <h2 className={heading}>{t('architecture')}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-muted">
            {scope.architecture}
          </p>
        </div>
      )}

      {scope.techStack.length > 0 && (
        <div className={card}>
          <h2 className={heading}>{t('tech_stack')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {scope.techStack.map((item) => (
              <div key={`${item.category}-${item.name}`} className="rounded-lg bg-surface p-3">
                <p className="text-sm font-semibold text-on-surface">{item.name}</p>
                <p className="text-xs text-on-surface-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {scope.workPackages.length > 0 && (
        <div className={card}>
          <div className="flex items-baseline justify-between">
            <h2 className={heading}>{t('work_packages')}</h2>
            {scope.totalEstimatedHours > 0 && (
              <span className="text-xs text-on-surface-muted">
                {scope.totalEstimatedHours} {t('hours')}
              </span>
            )}
          </div>
          <div className="mt-3 space-y-3">
            {scope.workPackages.map((wp) => (
              <div key={wp.name} className="rounded-lg bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-on-surface">{wp.name}</p>
                  {wp.estimatedHours > 0 && (
                    <span className="shrink-0 text-xs text-on-surface-muted">
                      {wp.estimatedHours} {t('hours')}
                    </span>
                  )}
                </div>
                {wp.requiredSkills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {wp.requiredSkills.map((skill) => (
                      <span key={skill} className={chip}>
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
                {wp.deliverables.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-on-surface-muted">
                      {t('deliverables')}
                    </p>
                    <ul className="mt-1 list-inside list-disc text-xs text-on-surface-muted">
                      {wp.deliverables.map((d) => (
                        <li key={d.title}>{d.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {wp.acceptanceCriteria.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-on-surface-muted">
                      {t('acceptance_criteria')}
                    </p>
                    <ul className="mt-1 list-inside list-disc text-xs text-on-surface-muted">
                      {wp.acceptanceCriteria.map((crit) => (
                        <li key={crit}>{crit}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {scope.sprintPlan.length > 0 && (
        <div className={card}>
          <h2 className={heading}>{t('sprint_plan')}</h2>
          <div className="mt-3 space-y-2">
            {scope.sprintPlan.map((sprint) => (
              <div key={sprint.name} className="rounded-lg bg-surface p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-on-surface">{sprint.name}</p>
                  <span className="shrink-0 text-xs text-on-surface-muted">{sprint.duration}</span>
                </div>
                {sprint.milestones.length > 0 && (
                  <p className="mt-1 text-xs text-on-surface-muted">
                    {sprint.milestones.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(scope.assumptions.length > 0 || scope.risks.length > 0) && (
        <div className={card}>
          <div className="grid gap-6 sm:grid-cols-2">
            {scope.assumptions.length > 0 && (
              <div>
                <h2 className={heading}>{t('assumptions')}</h2>
                <ul className="mt-2 list-inside list-disc text-xs text-on-surface-muted">
                  {scope.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {scope.risks.length > 0 && (
              <div>
                <h2 className={heading}>{t('risk_assessment')}</h2>
                <ul className="mt-2 list-inside list-disc text-xs text-on-surface-muted">
                  {scope.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function PublicProjectDetailPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const { projectId } = Route.useParams()
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [workPackages, setWorkPackages] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  // A logged-in talent applies straight from here; an owner never applies; a
  // guest is sent to register. This page is public, so the user may be absent.
  const user = useAuthStore((s) => s.user)
  const isTalent = !!user && user.role === 'talent'
  const { data: talentProfile } = useTalentProfile(isTalent ? user.id : '')
  const apply = useApplyToProject()
  const [applied, setApplied] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount is a retry trigger
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)

    // 404 means private/nonexistent: render not-found, never a retry loop
    // that can only fail again. Only real failures reach the error state.
    const loadProject = fetch(apiUrl(`/api/v1/projects/${projectId}`)).then(async (r) => {
      if (r.status === 404) return { data: null }
      if (!r.ok) throw new Error(`project fetch ${r.status}`)
      return r.json()
    })
    // Work packages are owner-gated; a public viewer gets 401/403.
    // Their absence must not fail the whole page.
    const loadWorkPackages = fetch(apiUrl(`/api/v1/work-packages/project/${projectId}`))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)

    Promise.all([loadProject, loadWorkPackages])
      .then(([projectRes, wpRes]) => {
        if (cancelled) return
        setProject(projectRes.data ?? null)
        if (wpRes?.success && Array.isArray(wpRes.data)) setWorkPackages(wpRes.data)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(true)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, reloadCount])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface">
        <p className="text-on-surface-muted">{tc('error_loading')}</p>
        <button
          type="button"
          onClick={() => setReloadCount((n) => n + 1)}
          className="mt-4 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        >
          {tc('retry')}
        </button>
        <Link
          to="/browse-projects"
          className="mt-3 text-sm text-primary-600 hover:text-primary-500"
        >
          {t('back_to_project_list')}
        </Link>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface">
        <p className="text-on-surface-muted">{t('project_not_found')}</p>
        <Link
          to="/browse-projects"
          className="mt-4 text-sm text-primary-600 hover:text-primary-500"
        >
          {t('back_to_project_list')}
        </Link>
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    matching: 'bg-warning-500/20 text-primary-600',
    team_forming: 'bg-warning-500/20 text-primary-600',
    matched: 'bg-primary-500/20 text-primary-600',
    in_progress: 'bg-success-500/20 text-success-600',
    review: 'bg-primary-600/20 text-primary-600',
    completed: 'bg-success-500/10 text-success-600',
  }
  const projectStatus = (project.status as string) ?? ''
  const statusKey = `status_${projectStatus}`
  const statusTranslated = tc(statusKey)
  const status = {
    label: statusTranslated !== statusKey ? statusTranslated : projectStatus,
    color: statusColors[projectStatus] ?? 'bg-surface-bright text-on-surface-muted',
  }
  const isOpen = project.status === 'matching' || project.status === 'team_forming'
  const rawSkills = (project.preferences as Record<string, unknown> | null)?.requiredSkills
  const requiredSkills = Array.isArray(rawSkills) ? (rawSkills as string[]) : []
  // Present only when the owner chose public_detail; absent otherwise.
  const scope = (project.scope as PublicScope | null) ?? null

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Back */}
        <Link
          to="/browse-projects"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back_to_project_list')}
        </Link>

        {/* Title + Status */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary-600">{project.title as string}</h1>
            <div className="mt-2 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.color}`}>
                {status.label}
              </span>
              <span className="text-xs text-on-surface-muted">
                {t((project.category as string) ?? '')}
              </span>
            </div>
          </div>
          {isOpen &&
            (user == null ? (
              <Link
                to="/register"
                className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
              >
                {t('apply_project')}
              </Link>
            ) : isTalent ? (
              <button
                type="button"
                disabled={apply.isPending || applied || !talentProfile}
                onClick={() => {
                  if (!talentProfile) return
                  apply.mutate(
                    { projectId, talentId: talentProfile.id },
                    { onSuccess: () => setApplied(true) },
                  )
                }}
                className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {applied ? t('applied') : apply.isPending ? t('applying') : t('apply_project')}
              </button>
            ) : null)}
        </div>

        {/* Info Cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <p className="text-xs text-on-surface-muted">{t('budget_label')}</p>
            <p className="mt-1 text-lg font-bold text-primary-600">
              {formatCurrency(project.budgetMin as number)} -{' '}
              {formatCurrency(project.budgetMax as number)}
            </p>
          </div>
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <div className="flex items-center gap-2 text-xs text-on-surface-muted">
              <Clock className="h-3.5 w-3.5" /> {t('timeline_label')}
            </div>
            <p className="mt-1 text-lg font-bold text-on-surface">
              {project.estimatedTimelineDays as number} {t('days')}
            </p>
          </div>
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <div className="flex items-center gap-2 text-xs text-on-surface-muted">
              <Users className="h-3.5 w-3.5" /> {t('team_label')}
            </div>
            <p className="mt-1 text-lg font-bold text-on-surface">
              {(project.teamSize as number) ?? 1} {t('people')}
            </p>
            {workPackages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {workPackages.map((wp: Record<string, unknown>) => (
                  <span
                    key={wp.id as string}
                    className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-600"
                  >
                    {wp.title as string}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
          <h2 className="text-sm font-semibold text-primary-600">{t('project_description')}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-muted">
            {project.description as string}
          </p>
        </div>

        {/* Team Composition */}
        {workPackages.length > 0 && (
          <div className="mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
            <h2 className="text-sm font-semibold text-primary-600">{t('team_composition')}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {workPackages.map((wp) => (
                <div
                  key={wp.id as string}
                  className="flex items-start gap-3 rounded-lg bg-surface p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500/10 text-xs font-bold text-primary-500">
                    {((wp.title as string) ?? '?').charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{wp.title as string}</p>
                    <p className="text-xs text-on-surface-muted">{wp.description as string}</p>
                    {Array.isArray(wp.requiredSkills) &&
                      (wp.requiredSkills as string[]).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(wp.requiredSkills as string[]).map((skill) => (
                            <span
                              key={skill}
                              className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-medium text-on-surface-muted"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Required Skills */}
        {requiredSkills.length > 0 && (
          <div className="mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
            <h2 className="text-sm font-semibold text-primary-600">{t('required_skills_label')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {requiredSkills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-lg bg-primary-500/10 px-3 py-1 text-xs font-semibold text-primary-600"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scope, on public_detail only. Served by GET /:id as a projection of
            the PRD, never the PRD itself: no package amount, no total cost. */}
        {scope && <ProjectScope scope={scope} />}

        {/* CTA for guests only; a logged-in talent applies inline above. */}
        {isOpen && user == null && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <Lock className="mx-auto h-8 w-8 text-success-600" />
            <h3 className="mt-3 text-lg font-semibold text-primary-600">
              {t('interested_in_project')}
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">{t('register_or_login_to_apply')}</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
              >
                {t('register_now')}
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-outline-dim/20 px-6 py-2.5 text-sm font-medium text-on-surface-muted hover:bg-surface-bright"
              >
                {t('already_have_account')}
              </Link>
            </div>
          </div>
        )}

        {/* Completed badge */}
        {project.status === 'completed' && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <CheckCircle className="mx-auto h-8 w-8 text-success-600" />
            <h3 className="mt-3 text-lg font-semibold text-success-600">
              {t('project_completed_title')}
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">
              {t('project_completed_description')}
            </p>
          </div>
        )}

        {/* Posted date */}
        <p className="mt-6 text-xs text-on-surface-muted">
          {t('posted_at', { date: formatDate(project.createdAt as string) })}
        </p>
      </div>
    </div>
  )
}
