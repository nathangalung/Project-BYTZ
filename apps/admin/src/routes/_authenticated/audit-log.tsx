import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ChevronDown,
  DollarSign,
  FolderOpen,
  Search,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateTime } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/audit-log')({
  component: AuditLogPage,
})

type AuditCategory = 'user' | 'project' | 'finance' | 'dispute' | 'config' | 'system'

type AuditEntry = {
  id: string
  adminId: string
  adminName: string | null
  adminEmail: string | null
  action: string
  targetType: string
  targetId: string
  details: Record<string, unknown> | null
  createdAt: string
}

type AuditLogResponse = {
  success: boolean
  data: {
    items: AuditEntry[]
    total: number
    page: number
    pageSize: number
  }
}

async function fetchAuditLogs(page: number, pageSize: number): Promise<AuditLogResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  const res = await fetch(`/api/v1/admin/audit-logs?${params.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch audit logs')
  return res.json()
}

function deriveCategory(action: string): AuditCategory {
  const prefix = action.split('.')[0]
  switch (prefix) {
    case 'user':
      return 'user'
    case 'project':
      return 'project'
    case 'finance':
    case 'payment':
    case 'transaction':
      return 'finance'
    case 'dispute':
      return 'dispute'
    case 'config':
    case 'setting':
    case 'settings':
      return 'config'
    default:
      return 'system'
  }
}

const SKELETON_ROW_KEYS = ['s1', 's2', 's3', 's4', 's5'] as const

const CATEGORY_CONFIG: Record<AuditCategory, { icon: React.ReactNode; color: string }> = {
  user: { icon: <Users className="h-3.5 w-3.5" />, color: 'bg-warning-500/20 text-warning-500' },
  project: {
    icon: <FolderOpen className="h-3.5 w-3.5" />,
    color: 'bg-success-500/20 text-success-500',
  },
  finance: {
    icon: <DollarSign className="h-3.5 w-3.5" />,
    color: 'bg-success-500/15 text-success-500',
  },
  dispute: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'bg-error-500/20 text-error-500',
  },
  config: {
    icon: <Settings className="h-3.5 w-3.5" />,
    color: 'bg-neutral-500/20 text-neutral-300',
  },
  system: { icon: <Shield className="h-3.5 w-3.5" />, color: 'bg-neutral-500/20 text-neutral-300' },
}

function AuditLogPage() {
  const { t } = useTranslation('admin')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page] = useState(1)
  const pageSize = 50

  const auditQuery = useQuery({
    queryKey: ['admin-audit-logs', page, pageSize],
    queryFn: () => fetchAuditLogs(page, pageSize),
  })

  const allEntries = auditQuery.data?.data.items ?? []
  const filteredAudit = allEntries.filter((entry) => {
    const category = deriveCategory(entry.action)
    const matchesCategory = !categoryFilter || category === categoryFilter
    const target = `${entry.targetType}/${entry.targetId}`.toLowerCase()
    const matchesSearch =
      !searchQuery ||
      entry.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      target.includes(searchQuery.toLowerCase()) ||
      (entry.adminName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    return matchesCategory && matchesSearch
  })

  function renderDetails(details: Record<string, unknown> | null): string {
    if (!details) return ''
    return Object.entries(details)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `${key}: ${JSON.stringify(value)}`
        }
        return `${key}: ${value}`
      })
      .join(', ')
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">{t('audit_log', 'Audit Log')}</h1>
        <p className="mt-1 text-sm text-neutral-300">
          {t('audit_log_desc', 'Complete trail of all admin actions')}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_audit', 'Search by action or target...')}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>
        <div className="relative">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="appearance-none rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-3 pr-9 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          >
            <option value="">{t('all_categories', 'All Categories')}</option>
            <option value="user">{t('cat_user', 'User Actions')}</option>
            <option value="project">{t('cat_project', 'Project Actions')}</option>
            <option value="finance">{t('cat_finance', 'Finance Actions')}</option>
            <option value="dispute">{t('cat_dispute', 'Dispute Actions')}</option>
            <option value="config">{t('cat_config', 'Config Changes')}</option>
            <option value="system">{t('cat_system', 'System Actions')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
        </div>
      </div>

      <p className="mb-4 text-sm text-neutral-300">
        {auditQuery.isLoading
          ? t('loading', 'Loading...')
          : t('showing_entries', 'Showing {{count}} entries', { count: filteredAudit.length })}
      </p>

      <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary-700/60">
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('timestamp', 'Timestamp')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('admin_user', 'Admin')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('action', 'Action')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('target', 'Target')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('details', 'Details')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {auditQuery.isLoading ? (
                SKELETON_ROW_KEYS.map((rowKey) => (
                  <tr key={rowKey} className="animate-pulse">
                    <td className="px-4 py-3">
                      <div className="h-3 w-24 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-32 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-20 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-40 rounded bg-primary-700/50" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3 w-48 rounded bg-primary-700/50" />
                    </td>
                  </tr>
                ))
              ) : auditQuery.isError ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-error-500">
                    {t('load_failed', 'Failed to load data')}
                  </td>
                </tr>
              ) : filteredAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-300">
                    {t('no_audit_entries', 'No audit entries found')}
                  </td>
                </tr>
              ) : (
                filteredAudit.map((entry) => {
                  const category = deriveCategory(entry.action)
                  const catConf = CATEGORY_CONFIG[category]
                  const adminLabel = entry.adminName ?? entry.adminId.slice(0, 8)
                  return (
                    <tr key={entry.id} className="transition-colors hover:bg-primary-700/30">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-300">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-700 text-[10px] font-semibold text-warning-500">
                            {adminLabel
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .substring(0, 2)
                              .toUpperCase()}
                          </div>
                          <span className="text-sm text-neutral-300">{adminLabel}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            catConf.color,
                          )}
                        >
                          {catConf.icon}
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm text-neutral-200">{entry.targetType}</p>
                          <p className="text-xs text-neutral-300">{entry.targetId}</p>
                        </div>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <p
                          className="truncate text-xs text-neutral-300"
                          title={renderDetails(entry.details)}
                        >
                          {renderDetails(entry.details)}
                        </p>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
