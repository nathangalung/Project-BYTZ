import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, ChevronDown, Clock, FolderOpen, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/browse')({
  component: AuthenticatedBrowsePage,
})

async function fetchPublicProjects(category?: string, page = 1) {
  const params = new URLSearchParams({ page: String(page), pageSize: '12' })
  if (category) params.set('category', category)
  try {
    const res = await fetch(apiUrl(`/api/v1/projects/public?${params}`), { credentials: 'include' })
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
  matched: 'bg-primary-500/20 text-primary-800',
  in_progress: 'bg-success-500/20 text-primary-800',
  review: 'bg-info-500/20 text-primary-800',
  completed: 'bg-success-500/10 text-primary-800',
}

const CATEGORIES = ['', 'web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other']

function AuthenticatedBrowsePage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')

  const statusLabel = (status: string) => {
    const key = `status_${status}`
    const translated = tc(key)
    return translated !== key ? translated : status
  }

  const [projects, setProjects] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    fetchPublicProjects(category).then((d) => {
      const items = (d.items as Record<string, unknown>[]) ?? []
      setProjects(statusFilter ? items.filter((p) => p.status === statusFilter) : items)
      setLoading(false)
    })
  }, [category, statusFilter])

  const PUBLIC_STATUSES = [
    'matching',
    'team_forming',
    'matched',
    'in_progress',
    'review',
    'completed',
  ]

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary-600">{tc('browse_projects')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">{tc('browse_desc')}</p>
      </div>

      {/* Filters row */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {/* Status dropdown */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none rounded-lg border border-outline-dim/20 bg-surface-bright py-2 pl-3 pr-9 text-sm text-on-surface focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          >
            <option value="">{tc('all')}</option>
            {PUBLIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tc(`status_${s}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-muted" />
        </div>
      </div>

      {/* Category filter */}
      <nav aria-label={t('filter_by_category')} className="mb-6 flex flex-wrap gap-2">
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
            {c ? t(c) : tc('all')}
          </button>
        ))}
      </nav>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`skeleton-${String(i)}`}
              className="h-52 animate-pulse rounded-xl bg-surface-bright"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="py-16 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-on-surface-muted" />
          <p className="mt-4 text-on-surface-muted">{t('no_projects_public')}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const cat = ((p.category as string) ?? '').replace(/_/g, ' ')
            const skills =
              ((p.preferences as Record<string, unknown>)?.required_skills as string[]) ?? []
            return (
              <Link
                key={p.id as string}
                to="/project-detail/$projectId"
                params={{ projectId: p.id as string }}
                className="flex flex-col justify-between rounded-xl border border-outline-dim/10 bg-surface-bright p-4 transition-all hover:border-primary-500/30 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold leading-snug text-primary-700">
                      {p.title as string}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[(p.status as string) ?? ''] ?? 'bg-surface-bright text-on-surface-muted'}`}
                    >
                      {statusLabel((p.status as string) ?? '')}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-on-surface-muted">
                    {p.description as string}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {cat && (
                      <span className="rounded-md bg-primary-500/10 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                        {cat}
                      </span>
                    )}
                    {skills.slice(0, 3).map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600"
                      >
                        {s}
                      </span>
                    ))}
                    {skills.length > 3 && (
                      <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                        +{skills.length - 3}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 border-t border-outline-dim/10 pt-3">
                  <div className="flex items-center justify-between text-xs text-on-surface-muted">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {p.estimatedTimelineDays as number} {t('days')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {(p.teamSize as number) ?? 1}
                      </span>
                    </div>
                    {(p.status === 'matching' || p.status === 'team_forming') && (
                      <span className="flex items-center gap-1 rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-bold text-success-600">
                        {t('open_for_talent')}
                        <ArrowRight className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-bold text-primary-800">
                    {formatCurrency(p.budgetMin as number)} -{' '}
                    {formatCurrency(p.budgetMax as number)}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
