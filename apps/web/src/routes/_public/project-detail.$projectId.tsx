import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle, Clock, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_public/project-detail/$projectId')({
  component: PublicProjectDetailPage,
})

function PublicProjectDetailPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const { projectId } = Route.useParams()
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setProject(d.data ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
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
        <p className="text-on-surface-muted">Proyek tidak ditemukan</p>
        <Link
          to="/browse-projects"
          className="mt-4 text-sm text-primary-600 hover:text-primary-500"
        >
          Kembali ke daftar proyek
        </Link>
      </div>
    )
  }

  const statusConfig: Record<string, { label: string; color: string }> = {
    matching: { label: tc('status_matching'), color: 'bg-warning-500/20 text-primary-600' },
    team_forming: { label: tc('status_matching'), color: 'bg-warning-500/20 text-primary-600' },
    in_progress: { label: tc('status_in_progress'), color: 'bg-success-500/20 text-success-600' },
    review: { label: tc('status_review'), color: 'bg-info-500/20 text-info-500' },
    completed: { label: tc('status_completed'), color: 'bg-success-500/10 text-success-600' },
  }

  const status = statusConfig[(project.status as string) ?? ''] ?? {
    label: project.status,
    color: 'bg-surface-bright text-on-surface-muted',
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
          Kembali
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
                {t(
                  (project.category as string) ?? '',
                  (project.category as string)?.replace('_', ' '),
                )}
              </span>
            </div>
          </div>
          {isOpen && (
            <Link
              to="/register"
              className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
            >
              {t('apply', 'Lamar')} Proyek
            </Link>
          )}
        </div>

        {/* Info Cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <p className="text-xs text-on-surface-muted">Budget</p>
            <p className="mt-1 text-lg font-bold text-primary-600">
              {formatCurrency(project.budgetMin as number)} -{' '}
              {formatCurrency(project.budgetMax as number)}
            </p>
          </div>
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <div className="flex items-center gap-2 text-xs text-on-surface-muted">
              <Clock className="h-3.5 w-3.5" /> Timeline
            </div>
            <p className="mt-1 text-lg font-bold text-on-surface">
              {project.estimatedTimelineDays as number} hari
            </p>
          </div>
          <div className="rounded-xl border border-outline-dim/10 bg-surface-bright p-4">
            <div className="flex items-center gap-2 text-xs text-on-surface-muted">
              <Users className="h-3.5 w-3.5" /> Tim
            </div>
            <p className="mt-1 text-lg font-bold text-on-surface">
              {(project.teamSize as number) ?? 1} orang
            </p>
          </div>
        </div>

        {/* Description */}
        <div className="mt-6 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
          <h2 className="text-sm font-semibold text-primary-600">Deskripsi Proyek</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-muted">
            {project.description as string}
          </p>
        </div>

        {/* CTA for non-logged-in */}
        {isOpen && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <Lock className="mx-auto h-8 w-8 text-success-600" />
            <h3 className="mt-3 text-lg font-semibold text-primary-600">
              Tertarik dengan proyek ini?
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">
              Daftar atau masuk untuk melamar proyek ini
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
              >
                Daftar Sekarang
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-outline-dim/20 px-6 py-2.5 text-sm font-medium text-on-surface-muted hover:bg-surface-bright"
              >
                Sudah Punya Akun
              </Link>
            </div>
          </div>
        )}

        {/* Completed badge */}
        {project.status === 'completed' && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <CheckCircle className="mx-auto h-8 w-8 text-success-600" />
            <h3 className="mt-3 text-lg font-semibold text-success-600">Proyek Selesai</h3>
            <p className="mt-1 text-sm text-on-surface-muted">
              Proyek ini telah berhasil diselesaikan melalui platform KerjaCUS!
            </p>
          </div>
        )}

        {/* Posted date */}
        <p className="mt-6 text-xs text-on-surface-muted">
          Diposting {formatDate(project.createdAt as string)}
        </p>
      </div>
    </div>
  )
}
