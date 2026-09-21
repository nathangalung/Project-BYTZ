import { Link } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle, Clock, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  APPLY_PRESENTATION,
  applyRejectionMessage,
  resolveApplyGate,
} from '@/components/project/apply-gate'
import { SeatPayout } from '@/components/project/seat-payout'
import { TimelineRange } from '@/components/project/timeline-range'
import {
  hasLiveApplicationFor,
  useApplyToProject,
  useTalentApplications,
  useTalentProfile,
} from '@/hooks/use-talent'
import { apiUrl } from '@/lib/api'
import { projectStatusBadge, projectStatusLabel } from '@/lib/project-status'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

/** Where the back links return to, so each host route stays inside its shell. */
type BackTo = '/browse' | '/browse-projects'

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
  const heading = 'text-sm font-semibold text-brand-text'
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

export function ProjectDetailView({ projectId, backTo }: { projectId: string; backTo: BackTo }) {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const { t: tt } = useTranslation('talent')
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [workPackages, setWorkPackages] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  // A logged-in talent applies straight from here; an owner never applies; a
  // guest is sent to register. This page is public, so the user may be absent.
  const user = useAuthStore((s) => s.user)
  const isTalent = !!user && user.role === 'talent'
  const { data: talentProfile, isError: talentProfileMissing } = useTalentProfile(
    isTalent ? user.id : '',
  )
  const { data: applications } = useTalentApplications(talentProfile?.id ?? '')
  const apply = useApplyToProject()
  // The list refetches after a successful apply, but not before the button has
  // to stop offering a second one.
  const [appliedNow, setAppliedNow] = useState(false)

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
      <div className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-surface">
        <p className="text-on-surface-muted">{tc('error_loading')}</p>
        <button
          type="button"
          onClick={() => setReloadCount((n) => n + 1)}
          className="mt-4 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          {tc('retry')}
        </button>
        <Link to={backTo} className="mt-3 text-sm text-brand-text hover:text-brand-accent">
          {t('back_to_project_list')}
        </Link>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-surface">
        <p className="text-on-surface-muted">{t('project_not_found')}</p>
        <Link to={backTo} className="mt-4 text-sm text-brand-text hover:text-brand-accent">
          {t('back_to_project_list')}
        </Link>
      </div>
    )
  }

  const projectStatus = (project.status as string) ?? ''
  // The card and this header read the same catalogue now. They used to read
  // two, and five statuses had different Indonesian words in each.
  const status = {
    label: projectStatusLabel(t, projectStatus),
    color: projectStatusBadge(projectStatus),
  }
  const rawSkills = (project.preferences as Record<string, unknown> | null)?.requiredSkills
  const requiredSkills = Array.isArray(rawSkills) ? (rawSkills as string[]) : []
  // Present only when the owner chose public_detail; absent otherwise.
  const scope = (project.scope as PublicScope | null) ?? null

  const gate = resolveApplyGate({
    projectStatus,
    openPositions: (project.openPositions as number | null) ?? null,
    ownerId: (project.ownerId as string | null) ?? null,
    userId: user?.id ?? null,
    userRole: user?.role ?? null,
    profile: talentProfile,
    profileMissing: talentProfileMissing,
    hasLiveApplication: appliedNow || hasLiveApplicationFor(applications, projectId),
  })
  const presentation = APPLY_PRESENTATION[gate]
  const translateTalent = (key: string) => tt(key)
  const rejection = apply.error ? applyRejectionMessage(apply.error, translateTalent) : null

  function handleApply() {
    /* v8 ignore next */
    if (!talentProfile) return
    apply.mutate(
      { projectId, talentId: talentProfile.id },
      {
        onSuccess: () => {
          setAppliedNow(true)
          useToastStore.getState().addToast('success', tt('apply_success'))
        },
        // Without this the rejection landed in apply.error and nothing read
        // it: the spinner stopped, the button came back, and the talent was
        // never told the server had refused them.
        onError: (err) => {
          useToastStore.getState().addToast('error', applyRejectionMessage(err, translateTalent))
        },
      },
    )
  }

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Back */}
        <Link
          to={backTo}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-brand-text"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back_to_project_list')}
        </Link>

        {/* Title + Status */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-text">{project.title as string}</h1>
            <div className="mt-2 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.color}`}>
                {status.label}
              </span>
              <span className="text-xs text-on-surface-muted">
                {t((project.category as string) ?? '')}
              </span>
            </div>
          </div>
          {gate === 'guest' && (
            <Link
              to="/register"
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              {t('apply_project')}
            </Link>
          )}
          {presentation.label && (
            <button
              type="button"
              disabled={gate !== 'ready' || apply.isPending}
              onClick={handleApply}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {apply.isPending ? t('applying') : t(presentation.label)}
            </button>
          )}
        </div>

        {/* Why the button cannot be pressed, and where to go about it. A
            button that only fails on click is worse than one that says why. */}
        {presentation.notice && (
          <div
            role="status"
            className="mt-4 rounded-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-on-surface"
          >
            {tt(presentation.notice.key)}{' '}
            {presentation.notice.to && presentation.notice.action && (
              <Link to={presentation.notice.to} className="font-semibold underline">
                {tt(presentation.notice.action)}
              </Link>
            )}
          </div>
        )}

        {/* A refusal the pre-checks could not foresee: a seat taken while the
            page was open, a status changed underneath it. */}
        {rejection && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-error-600/30 bg-error-500/10 px-4 py-3 text-sm text-on-surface"
          >
            {rejection}
          </div>
        )}

        {/* Info Cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <SeatPayout
              payoutMin={(project.payoutMin as number | null) ?? null}
              payoutMax={(project.payoutMax as number | null) ?? null}
              openPositions={(project.openPositions as number) ?? 0}
            />
          </div>
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <div className="flex items-center gap-2 text-xs text-on-surface-muted">
              <Clock className="h-3.5 w-3.5" /> {t('timeline_label')}
            </div>
            <p className="mt-1 text-lg font-bold text-on-surface">
              <TimelineRange days={project.estimatedTimelineDays as number} />
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
                    className="rounded bg-brand-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-text"
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
          <h2 className="text-sm font-semibold text-brand-text">{t('project_description')}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-muted">
            {project.description as string}
          </p>
        </div>

        {/* Team Composition */}
        {workPackages.length > 0 && (
          <div className="mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
            <h2 className="text-sm font-semibold text-brand-text">{t('team_composition')}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {workPackages.map((wp) => (
                <div
                  key={wp.id as string}
                  className="flex items-start gap-3 rounded-lg bg-surface p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-xs font-bold text-brand-accent">
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
            <h2 className="text-sm font-semibold text-brand-text">{t('required_skills_label')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {requiredSkills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-lg bg-brand-accent/10 px-3 py-1 text-xs font-semibold text-brand-text"
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
        {gate === 'guest' && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <Lock className="mx-auto h-8 w-8 text-success-600" />
            <h3 className="mt-3 text-lg font-semibold text-brand-text">
              {t('interested_in_project')}
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">{t('register_or_login_to_apply')}</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
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
