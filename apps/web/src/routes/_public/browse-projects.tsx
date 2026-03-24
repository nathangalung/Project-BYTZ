import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Clock, FolderOpen, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  matching: 'bg-warning-500/20 text-primary-800',
  team_forming: 'bg-warning-500/20 text-primary-800',
  in_progress: 'bg-success-500/20 text-primary-800',
  completed: 'bg-success-500/10 text-primary-800',
}

const CATEGORIES = ['', 'web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital']

function PublicProjectsPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      matching: tc('status_matching'),
      team_forming: tc('status_matching'),
      in_progress: tc('status_in_progress'),
      review: tc('status_review'),
      completed: tc('status_completed'),
    }
    return map[status] ?? status
  }
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
    <div>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-3xl font-bold text-primary-600">
          {t('browse_projects', 'Jelajahi Proyek')}
        </h1>
        <p className="mt-2 text-on-surface-muted">
          {t('browse_desc', 'Lihat proyek yang sedang dikerjakan atau butuh talenta')}
        </p>

        {/* Category filter */}
        <nav
          aria-label={t('filter_by_category', 'Filter kategori')}
          className="mt-6 flex flex-wrap gap-2"
        >
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                category === c
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-bright text-on-surface-muted hover:bg-surface-high'
              }`}
            >
              {c ? t(c, c.replace('_', ' ')) : t('all', 'Semua')}
            </button>
          ))}
        </nav>

        {/* Grid */}
        <h2 className="sr-only">{t('project_list', 'Daftar Proyek')}</h2>
        {loading ? (
          <div className="mt-8 grid min-h-[500px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${String(i)}`}
                className="h-52 animate-pulse rounded-xl bg-surface-bright"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-16 text-center">
            <FolderOpen aria-hidden="true" className="mx-auto h-12 w-12 text-on-surface-muted" />
            <p className="mt-4 text-on-surface-muted">
              {t('no_projects_public', 'Belum ada proyek tersedia')}
            </p>
          </div>
        ) : (
          <div className="mt-8 grid min-h-[500px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id as string}
                to="/project-detail/$projectId"
                params={{ projectId: p.id as string }}
                className="block rounded-xl border border-outline-dim/10 bg-surface-bright p-5 transition-colors hover:border-primary-500/20"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-primary-600">{p.title as string}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[(p.status as string) ?? ''] ??
                      'bg-surface-bright text-on-surface-muted'
                    }`}
                  >
                    {statusLabel((p.status as string) ?? '')}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-on-surface-muted">
                  {p.description as string}
                </p>
                <div className="mt-4 flex items-center gap-4 text-xs text-on-surface-muted">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {p.estimatedTimelineDays as number} {t('days', 'hari')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {(p.teamSize as number) ?? 1}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-on-surface">
                    {formatCurrency(p.budgetMin as number)} -{' '}
                    {formatCurrency(p.budgetMax as number)}
                  </span>
                  {(p.status === 'matching' || p.status === 'team_forming') && (
                    <span className="flex items-center gap-1 text-xs font-medium text-success-600">
                      {t('open_for_talent', 'Cari Talenta')}{' '}
                      <ArrowRight aria-hidden="true" className="h-3 w-3" />
                    </span>
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
