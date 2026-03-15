import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Clock, FolderOpen, Globe, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { formatCurrency } from '@/lib/utils'

export const Route = createFileRoute('/_public/browse-projects')({
  component: PublicProjectsPage,
})

async function fetchPublicProjects(category?: string, page = 1) {
  const params = new URLSearchParams({ page: String(page), pageSize: '12' })
  if (category) params.set('category', category)
  try {
    const res = await fetch(`/api/v1/projects/public?${params}`)
    if (!res.ok) return { items: [], total: 0 }
    const data = await res.json()
    return data.data ?? { items: [], total: 0 }
  } catch {
    return { items: [], total: 0 }
  }
}

const STATUS_COLORS: Record<string, string> = {
  matching: 'bg-warning-500/20 text-warning-500',
  team_forming: 'bg-warning-500/20 text-warning-500',
  in_progress: 'bg-success-500/20 text-success-500',
  completed: 'bg-success-500/10 text-success-600',
}

const CATEGORIES = ['', 'web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital']

function PublicProjectsPage() {
  const { t } = useTranslation('project')
  const [projects, setProjects] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')

  useEffect(() => {
    setLoading(true)
    fetchPublicProjects(category).then((d) => {
      setProjects((d.items as Record<string, unknown>[]) ?? [])
      setLoading(false)
    })
  }, [category])

  return (
    <div className="min-h-screen bg-primary-600">
      {/* Header */}
      <header className="border-b border-white/5 bg-primary-600/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-bold text-warning-500">
            BYTZ
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/request-project" className="text-sm text-neutral-400 hover:text-warning-500">
              Cara Mengajukan
            </Link>
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

      <div className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-3xl font-bold text-warning-500">
          {t('browse_projects', 'Jelajahi Proyek')}
        </h1>
        <p className="mt-2 text-neutral-500">
          {t('browse_desc', 'Lihat proyek yang sedang dikerjakan atau butuh worker')}
        </p>

        {/* Category filter */}
        <div className="mt-6 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                category === c
                  ? 'bg-success-500 text-primary-900'
                  : 'bg-neutral-600/40 text-neutral-400 hover:bg-neutral-600/60'
              }`}
            >
              {c ? t(c, c.replace('_', ' ')) : t('all', 'Semua')}
            </button>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${String(i)}`}
                className="h-48 animate-pulse rounded-xl bg-neutral-600/30"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-16 text-center">
            <FolderOpen className="mx-auto h-12 w-12 text-neutral-600" />
            <p className="mt-4 text-neutral-500">
              {t('no_projects_public', 'Belum ada proyek tersedia')}
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id as string}
                to="/project-detail/$projectId"
                params={{ projectId: p.id as string }}
                className="block rounded-xl border border-white/5 bg-neutral-600/30 p-5 transition-colors hover:border-success-500/20"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-warning-500">{p.title as string}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[(p.status as string) ?? ''] ??
                      'bg-neutral-600/50 text-neutral-400'
                    }`}
                  >
                    {(p.status as string)?.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-neutral-500">
                  {p.description as string}
                </p>
                <div className="mt-4 flex items-center gap-4 text-xs text-neutral-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {p.estimatedTimelineDays as number}d
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {(p.teamSize as number) ?? 1}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-300">
                    {formatCurrency(p.budgetMin as number)} -{' '}
                    {formatCurrency(p.budgetMax as number)}
                  </span>
                  {(p.status === 'matching' || p.status === 'team_forming') && (
                    <Link
                      to="/register"
                      className="flex items-center gap-1 text-xs font-medium text-success-500 hover:text-success-400"
                    >
                      Apply <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
