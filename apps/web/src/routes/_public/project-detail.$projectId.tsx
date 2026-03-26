import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle, Clock, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_public/project-detail/$projectId')({
  component: PublicProjectDetailPage,
})

function PublicProjectDetailPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const { projectId } = Route.useParams()
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [workPackages, setWorkPackages] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiUrl(`/api/v1/projects/${projectId}`))
      .then((r) => r.json())
      .then((d) => {
        setProject(d.data ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))

    fetch(apiUrl(`/api/v1/work-packages/project/${projectId}`))
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data)) setWorkPackages(d.data)
      })
      .catch(() => {})
  }, [projectId])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
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
    review: 'bg-info-500/20 text-info-500',
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
          {isOpen && (
            <Link
              to="/register"
              className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
            >
              {t('apply_project')}
            </Link>
          )}
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
                    className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-700"
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
                              className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
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
        {Array.isArray((project.preferences as Record<string, unknown>)?.required_skills) &&
          ((project.preferences as Record<string, unknown>)?.required_skills as string[]).length >
            0 && (
            <div className="mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
              <h2 className="text-sm font-semibold text-primary-600">
                {t('required_skills_label')}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  (project.preferences as Record<string, unknown>)?.required_skills as string[]
                ).map((skill) => (
                  <span
                    key={skill}
                    className="rounded-lg bg-primary-500/10 px-3 py-1 text-xs font-semibold text-primary-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

        {/* CTA for non-logged-in */}
        {isOpen && (
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
