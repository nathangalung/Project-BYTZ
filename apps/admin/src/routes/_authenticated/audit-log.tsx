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

type AuditEntry = {
  id: string
  adminName: string
  adminEmail: string
  action: string
  actionCategory: 'user' | 'project' | 'finance' | 'dispute' | 'config' | 'system'
  targetType: string
  targetId: string
  targetName: string
  details: Record<string, unknown>
  timestamp: string
}

const MOCK_AUDIT: AuditEntry[] = [
  {
    id: 'a1',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'user.suspend',
    actionCategory: 'user',
    targetType: 'user',
    targetId: 'u4',
    targetName: 'Dewi Lestari',
    details: {
      reason: 'Repeatedly refusing to approve valid milestone submissions without justification',
    },
    timestamp: '2026-03-15T09:30:00Z',
  },
  {
    id: 'a2',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'dispute.resolve',
    actionCategory: 'dispute',
    targetType: 'dispute',
    targetId: 'd3',
    targetName: 'Dashboard Analytics - Dispute',
    details: { resolution_type: 'funds_to_client', amount: 12000000 },
    timestamp: '2026-03-14T16:45:00Z',
  },
  {
    id: 'a3',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'project.status_change',
    actionCategory: 'project',
    targetType: 'project',
    targetId: 'p7',
    targetName: 'Chatbot Customer Service AI',
    details: { from: 'in_progress', to: 'disputed' },
    timestamp: '2026-03-14T14:20:00Z',
  },
  {
    id: 'a4',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'user.verify_worker',
    actionCategory: 'user',
    targetType: 'user',
    targetId: 'u5',
    targetName: 'Eko Prasetyo',
    details: { method: 'manual_override' },
    timestamp: '2026-03-13T11:00:00Z',
  },
  {
    id: 'a5',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'config.update',
    actionCategory: 'config',
    targetType: 'config',
    targetId: 'margin_rates',
    targetName: 'Platform Margin Rates',
    details: { changed: { below_10m: { from: 25, to: 27 } } },
    timestamp: '2026-03-12T10:15:00Z',
  },
  {
    id: 'a6',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'dispute.escalate',
    actionCategory: 'dispute',
    targetType: 'dispute',
    targetId: 'd4',
    targetName: 'Chatbot CS - Dispute',
    details: { reason: 'Mediation failed, both parties cannot agree' },
    timestamp: '2026-03-10T14:00:00Z',
  },
  {
    id: 'a7',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'finance.refund',
    actionCategory: 'finance',
    targetType: 'transaction',
    targetId: 't10',
    targetName: 'Landing Page Produk - Refund',
    details: { amount: 5000000, method: 'bank_transfer' },
    timestamp: '2026-03-05T09:30:00Z',
  },
  {
    id: 'a8',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'user.suspend',
    actionCategory: 'user',
    targetType: 'user',
    targetId: 'u9',
    targetName: 'Irfan Maulana',
    details: { reason: 'Second abandon incident - project abandoned without notice' },
    timestamp: '2026-02-20T15:00:00Z',
  },
  {
    id: 'a9',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'project.reassign_worker',
    actionCategory: 'project',
    targetType: 'project',
    targetId: 'p3',
    targetName: 'Dashboard Analytics Internal',
    details: { old_worker: 'Irfan Maulana', new_worker: 'Pending' },
    timestamp: '2026-02-15T10:00:00Z',
  },
  {
    id: 'a10',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'config.update',
    actionCategory: 'config',
    targetType: 'config',
    targetId: 'matching_weights',
    targetName: 'Matching Algorithm Weights',
    details: { changed: { pemerataan: { from: 30, to: 35 } } },
    timestamp: '2026-02-10T08:45:00Z',
  },
  {
    id: 'a11',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'user.warning',
    actionCategory: 'user',
    targetType: 'user',
    targetId: 'u4',
    targetName: 'Dewi Lestari',
    details: { reason: 'Attempting to contact worker directly outside platform' },
    timestamp: '2026-02-15T14:30:00Z',
  },
  {
    id: 'a12',
    adminName: 'Fitriani Wulandari',
    adminEmail: 'fitri.wulandari@example.com',
    action: 'system.dlq_reprocess',
    actionCategory: 'system',
    targetType: 'event',
    targetId: 'dlq-evt-001',
    targetName: 'payment.released - Failed Event',
    details: { retry_count: 3, outcome: 'success' },
    timestamp: '2026-02-08T16:20:00Z',
  },
]

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
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

  const filteredAudit = MOCK_AUDIT.filter((entry) => {
    const matchesCategory = !categoryFilter || entry.actionCategory === categoryFilter
    const matchesSearch =
      !searchQuery ||
      entry.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.targetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.adminName.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  function renderDetails(details: Record<string, unknown>): string {
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

      {/* Filters */}
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
        {t('showing_entries', 'Showing {{count}} entries', { count: filteredAudit.length })}
      </p>

      {/* Table */}
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
              {filteredAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-300">
                    {t('no_audit_entries', 'No audit entries found')}
                  </td>
                </tr>
              ) : (
                filteredAudit.map((entry) => {
                  const catConf = CATEGORY_CONFIG[entry.actionCategory]
                  return (
                    <tr key={entry.id} className="transition-colors hover:bg-primary-700/30">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-300">
                        {formatDateTime(entry.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-700 text-[10px] font-semibold text-warning-500">
                            {entry.adminName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .substring(0, 2)
                              .toUpperCase()}
                          </div>
                          <span className="text-sm text-neutral-300">{entry.adminName}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            catConf?.color,
                          )}
                        >
                          {catConf?.icon}
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm text-neutral-200">{entry.targetName}</p>
                          <p className="text-xs text-neutral-300">
                            {entry.targetType} / {entry.targetId}
                          </p>
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
