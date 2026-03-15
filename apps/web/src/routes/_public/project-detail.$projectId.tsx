import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle, Clock, Globe, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_public/project-detail/$projectId')({
  component: PublicProjectDetailPage,
})

function PublicProjectDetailPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/projects/public?pageSize=100`)
      .then((r) => r.json())
      .then((d) => {
        const found = (d.data?.items ?? []).find((p: Record<string, unknown>) => p.id === projectId)
        setProject(found ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary-600">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-success-500 border-t-transparent" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-primary-600">
        <p className="text-neutral-400">Proyek tidak ditemukan</p>
        <Link
          to="/browse-projects"
          className="mt-4 text-sm text-success-500 hover:text-success-400"
        >
          Kembali ke daftar proyek
        </Link>
      </div>
    )
  }

  const statusConfig: Record<string, { label: string; color: string }> = {
    matching: {
      label: 'Mencari Worker',
      color: 'bg-warning-500/20 text-warning-500',
    },
    team_forming: {
      label: 'Membentuk Tim',
      color: 'bg-warning-500/20 text-warning-500',
    },
    in_progress: {
      label: 'Sedang Dikerjakan',
      color: 'bg-success-500/20 text-success-500',
    },
    review: { label: 'Review', color: 'bg-info-500/20 text-info-500' },
    completed: { label: 'Selesai', color: 'bg-success-500/10 text-success-600' },
  }

  const status = statusConfig[(project.status as string) ?? ''] ?? {
    label: project.status,
    color: 'bg-neutral-600/50 text-neutral-400',
  }
  const isOpen = project.status === 'matching' || project.status === 'team_forming'

  return (
    <div className="min-h-screen bg-primary-600">
      {/* Header */}
      <header className="border-b border-white/5 bg-primary-600/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-bold text-warning-500">
            BYTZ
          </Link>
          <nav className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => i18n.changeLanguage(i18n.language === 'id' ? 'en' : 'id')}
              className="flex items-center gap-1 text-sm text-neutral-500 hover:text-warning-500"
            >
              <Globe className="h-4 w-4" />
              {i18n.language === 'id' ? 'EN' : 'ID'}
            </button>
            <Link to="/login" className="text-sm text-neutral-400 hover:text-warning-500">
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-success-500 px-4 py-2 text-sm font-medium text-primary-900"
            >
              Daftar
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Back */}
        <Link
          to="/browse-projects"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-warning-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </Link>

        {/* Title + Status */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-warning-500">{project.title as string}</h1>
            <div className="mt-2 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.color}`}>
                {status.label}
              </span>
              <span className="text-xs text-neutral-500">
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
              className="rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-900 hover:bg-success-600"
            >
              Apply sebagai Worker
            </Link>
          )}
        </div>

        {/* Info Cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-neutral-600/30 p-4">
            <p className="text-xs text-neutral-500">Budget</p>
            <p className="mt-1 text-lg font-bold text-warning-500">
              {formatCurrency(project.budgetMin as number)} -{' '}
              {formatCurrency(project.budgetMax as number)}
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-neutral-600/30 p-4">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Clock className="h-3.5 w-3.5" /> Timeline
            </div>
            <p className="mt-1 text-lg font-bold text-neutral-200">
              {project.estimatedTimelineDays as number} hari
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-neutral-600/30 p-4">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Users className="h-3.5 w-3.5" /> Tim
            </div>
            <p className="mt-1 text-lg font-bold text-neutral-200">
              {(project.teamSize as number) ?? 1} orang
            </p>
          </div>
        </div>

        {/* Description */}
        <div className="mt-6 rounded-xl border border-white/5 bg-neutral-600/30 p-6">
          <h2 className="text-sm font-semibold text-warning-500">Deskripsi Proyek</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
            {project.description as string}
          </p>
        </div>

        {/* CTA for non-logged-in */}
        {isOpen && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <Lock className="mx-auto h-8 w-8 text-success-500" />
            <h3 className="mt-3 text-lg font-semibold text-warning-500">
              Tertarik dengan proyek ini?
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              Daftar atau masuk untuk melamar sebagai worker
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-success-500 px-6 py-2.5 text-sm font-semibold text-primary-900 hover:bg-success-600"
              >
                Daftar Sekarang
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-white/10 px-6 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-600/30"
              >
                Sudah Punya Akun
              </Link>
            </div>
          </div>
        )}

        {/* Completed badge */}
        {project.status === 'completed' && (
          <div className="mt-8 rounded-xl border border-success-500/20 bg-success-500/5 p-6 text-center">
            <CheckCircle className="mx-auto h-8 w-8 text-success-500" />
            <h3 className="mt-3 text-lg font-semibold text-success-500">Proyek Selesai</h3>
            <p className="mt-1 text-sm text-neutral-500">
              Proyek ini telah berhasil diselesaikan melalui platform BYTZ
            </p>
          </div>
        )}

        {/* Posted date */}
        <p className="mt-6 text-xs text-neutral-600">
          Diposting {formatDate(project.createdAt as string)}
        </p>
      </div>
    </div>
  )
}
