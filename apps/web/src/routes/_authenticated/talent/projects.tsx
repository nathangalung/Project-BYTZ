import { createFileRoute, Link } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BackButton } from '@/components/ui/back-button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { QueryError } from '@/components/ui/query-error'
import { useTalentActiveProjects, useTalentProfile } from '@/hooks/use-talent'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/talent/projects')({
  component: TalentProjectsPage,
})

// The talent counterpart to the owner's My Projects: the projects this talent
// is staffed on, with their milestone, progress and deadline, not the owner's
// management controls.
function TalentProjectsPage() {
  const { t } = useTranslation('talent')
  const { t: tc } = useTranslation('common')
  const user = useAuthStore((s) => s.user)
  const { data: profile } = useTalentProfile(user?.id ?? '')
  const { data: projects, isLoading, isError, refetch } = useTalentActiveProjects(profile?.id ?? '')

  const list = projects ?? []

  return (
    <div className="p-4 lg:p-8">
      <BackButton to="/talent" />
      <h1 className="mb-8 text-2xl font-bold text-brand-text">{t('my_projects')}</h1>

      {isLoading ? (
        <div className="space-y-4">
          {['s1', 's2', 's3'].map((id) => (
            <div key={id} className="h-28 animate-pulse rounded-lg bg-surface-container" />
          ))}
        </div>
      ) : isError ? (
        <QueryError message={tc('active_projects_load_failed')} onRetry={() => void refetch()} />
      ) : list.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((project) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="block rounded-lg border border-outline-dim/20 bg-surface-bright p-5 transition-colors hover:border-brand-accent/30"
            >
              <h2 className="text-sm font-semibold text-on-surface">{project.title}</h2>
              <p className="mt-1 text-xs text-on-surface-muted">{project.currentMilestone}</p>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-on-surface-muted">{t('progress')}</span>
                  <span className="font-medium text-success-600">{project.progress}%</span>
                </div>
                <ProgressBar
                  value={project.progress}
                  label={t('progress')}
                  trackClassName="h-1.5"
                  barClassName="bg-success-500 transition-all"
                />
              </div>
              <p className="mt-3 text-xs text-on-surface-muted">
                {t('deadline')}: {formatDate(project.deadline)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-outline-dim/20 bg-surface-bright py-16 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-on-surface-muted" />
          <p className="mt-4 text-sm text-on-surface-muted">{t('no_active')}</p>
          <Link
            to="/browse"
            className="mt-4 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('browse_projects')}
          </Link>
        </div>
      )}
    </div>
  )
}
