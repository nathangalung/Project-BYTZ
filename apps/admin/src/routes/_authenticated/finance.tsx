import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRight,
  ChevronDown,
  DollarSign,
  Download,
  FileText,
  Lock,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/finance')({
  component: AdminFinancePage,
})

type FinanceSummary = {
  totalRevenue: number
  thisMonthRevenue: number
  lastMonthRevenue: number
  brdRevenue: number
  prdRevenue: number
  marginRevenue: number
  revisionFee: number
  placementFee: number
  escrowHeld: number
}

type EscrowProject = {
  projectId: string
  projectTitle: string
  status: string
  totalEscrow: number
  released: number
  remaining: number
}

type TransactionType =
  | 'escrow_in'
  | 'escrow_release'
  | 'brd_payment'
  | 'prd_payment'
  | 'refund'
  | 'partial_refund'
  | 'revision_fee'
  | 'talent_placement_fee'

type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'

type Transaction = {
  id: string
  projectId: string
  projectTitle: string
  talentId: string | null
  talentName: string | null
  type: TransactionType
  amount: number
  status: TransactionStatus
  paymentMethod: string | null
  paymentGatewayRef: string | null
  createdAt: string
}

type TransactionListResponse = {
  success: boolean
  data: {
    items: Transaction[]
    total: number
    page: number
    pageSize: number
  }
}

const TYPE_CONFIG: Record<TransactionType, { badge: string; label: string }> = {
  escrow_in: { badge: 'bg-success-500/20 text-success-500', label: 'Escrow In' },
  escrow_release: { badge: 'bg-success-500/15 text-success-500', label: 'Escrow Release' },
  brd_payment: { badge: 'bg-warning-500/20 text-warning-500', label: 'BRD Payment' },
  prd_payment: { badge: 'bg-warning-500/20 text-warning-500', label: 'PRD Payment' },
  refund: { badge: 'bg-error-500/20 text-error-500', label: 'Refund' },
  partial_refund: { badge: 'bg-error-500/15 text-error-500', label: 'Partial Refund' },
  revision_fee: { badge: 'bg-warning-500/25 text-warning-500', label: 'Revision Fee' },
  talent_placement_fee: { badge: 'bg-success-500/25 text-success-500', label: 'Placement Fee' },
}

const STATUS_BADGE: Record<TransactionStatus, string> = {
  completed: 'bg-success-500/20 text-success-500',
  processing: 'bg-warning-500/20 text-warning-500',
  pending: 'bg-neutral-500/20 text-neutral-300',
  failed: 'bg-error-500/20 text-error-500',
  refunded: 'bg-error-500/15 text-error-500',
}

async function fetchSummary(): Promise<FinanceSummary> {
  const res = await fetch('/api/v1/admin/finance/summary', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load finance summary')
  const body = (await res.json()) as { success: boolean; data: FinanceSummary }
  return body.data
}

async function fetchEscrow(): Promise<EscrowProject[]> {
  const res = await fetch('/api/v1/admin/finance/escrow?limit=20', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load escrow')
  const body = (await res.json()) as { success: boolean; data: EscrowProject[] }
  return body.data
}

async function fetchTransactions(params: {
  type: string
  search: string
  page: number
  pageSize: number
}): Promise<TransactionListResponse['data']> {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.search) query.set('search', params.search)
  query.set('page', String(params.page))
  query.set('pageSize', String(params.pageSize))
  const res = await fetch(`/api/v1/admin/finance/transactions?${query.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load transactions')
  const body = (await res.json()) as TransactionListResponse
  return body.data
}

function AdminFinancePage() {
  const { t } = useTranslation('admin')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page] = useState(1)
  const pageSize = 50

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
  const formatRpShort = (n: number) => {
    if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
    return formatRp(n)
  }

  const summaryQuery = useQuery({
    queryKey: ['admin-finance-summary'],
    queryFn: fetchSummary,
  })

  const escrowQuery = useQuery({
    queryKey: ['admin-finance-escrow'],
    queryFn: fetchEscrow,
  })

  const txnQuery = useQuery({
    queryKey: ['admin-finance-transactions', typeFilter, searchQuery, page, pageSize],
    queryFn: () => fetchTransactions({ type: typeFilter, search: searchQuery, page, pageSize }),
  })

  const transactions = txnQuery.data?.items ?? []
  const summary = summaryQuery.data
  const escrow = escrowQuery.data ?? []

  const revenueChange =
    summary && summary.lastMonthRevenue > 0
      ? ((summary.thisMonthRevenue - summary.lastMonthRevenue) / summary.lastMonthRevenue) * 100
      : 0

  function handleExportCSV() {
    if (transactions.length === 0) return
    const header = [
      'id',
      'projectTitle',
      'talentName',
      'type',
      'amount',
      'status',
      'method',
      'date',
    ]
    const rows = transactions.map((tx) => [
      tx.id,
      tx.projectTitle,
      tx.talentName ?? '',
      tx.type,
      String(tx.amount),
      tx.status,
      tx.paymentMethod ?? '',
      tx.createdAt,
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warning-500">{t('finance', 'Finance')}</h1>
          <p className="mt-1 text-sm text-neutral-300">
            {t('finance_desc', 'Financial overview and platform transactions')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCSV}
          disabled={transactions.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {t('export_csv', 'Export CSV')}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          icon={<DollarSign className="h-5 w-5 text-success-500" />}
          label={t('total_revenue', 'Total Revenue')}
          value={summaryQuery.isLoading ? '...' : formatRpShort(summary?.totalRevenue ?? 0)}
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5 text-success-500" />}
          label={t('this_month_revenue', 'This Month')}
          value={summaryQuery.isLoading ? '...' : formatRpShort(summary?.thisMonthRevenue ?? 0)}
          delta={
            summary && summary.lastMonthRevenue > 0 ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-success-500">
                <ArrowUpRight className="h-3 w-3" />
                <span>
                  {revenueChange >= 0 ? '+' : ''}
                  {revenueChange.toFixed(1)}%
                </span>
              </div>
            ) : null
          }
        />
        <SummaryCard
          icon={<FileText className="h-5 w-5 text-warning-500" />}
          label="BRD"
          value={summaryQuery.isLoading ? '...' : formatRpShort(summary?.brdRevenue ?? 0)}
        />
        <SummaryCard
          icon={<FileText className="h-5 w-5 text-warning-500" />}
          label="PRD"
          value={summaryQuery.isLoading ? '...' : formatRpShort(summary?.prdRevenue ?? 0)}
        />
        <SummaryCard
          icon={<DollarSign className="h-5 w-5 text-success-500" />}
          label={t('project_margin', 'Project Margin')}
          value={summaryQuery.isLoading ? '...' : formatRpShort(summary?.marginRevenue ?? 0)}
        />
        <SummaryCard
          icon={<Wallet className="h-5 w-5 text-error-500" />}
          label={t('escrow_held', 'Escrow Held')}
          value={summaryQuery.isLoading ? '...' : formatRpShort(summary?.escrowHeld ?? 0)}
          delta={
            <div className="mt-1 flex items-center gap-1 text-xs text-error-500">
              <Lock className="h-3 w-3" />
              <span>{t('frozen_funds', 'Frozen funds')}</span>
            </div>
          }
        />
      </div>

      <div className="mt-8 rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="border-b border-primary-700/60 px-6 py-4">
          <h2 className="text-lg font-semibold text-warning-500">
            {t('escrow_by_project', 'Escrow by Active Project')}
          </h2>
        </div>
        <div className="p-6">
          {escrowQuery.isError ? (
            <p className="text-sm text-error-500">
              {t('failed_to_load', 'Failed to load')}: {String(escrowQuery.error)}
            </p>
          ) : escrowQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-primary-700" />
              ))}
            </div>
          ) : escrow.length === 0 ? (
            <p className="text-sm text-neutral-300">
              {t('no_escrow', 'No projects with held escrow')}
            </p>
          ) : (
            <div className="space-y-4">
              {escrow.map((esc) => {
                const releasedPct = esc.totalEscrow > 0 ? (esc.released / esc.totalEscrow) * 100 : 0
                return (
                  <div key={esc.projectId} className="rounded-lg bg-primary-700 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-neutral-200">{esc.projectTitle}</p>
                        <span
                          className={cn(
                            'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            esc.status === 'disputed'
                              ? 'bg-error-500/20 text-error-500'
                              : 'bg-success-500/20 text-success-500',
                          )}
                        >
                          {esc.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-warning-500">
                          {formatRpShort(esc.remaining)}
                        </p>
                        <p className="text-xs text-neutral-300">
                          {t('of', 'of')} {formatRpShort(esc.totalEscrow)}
                        </p>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-primary-800">
                      <div
                        className="h-full rounded-full bg-success-500"
                        style={{ width: `${releasedPct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs text-neutral-300">
                      <span>
                        {t('released', 'Released')}: {formatRpShort(esc.released)}
                      </span>
                      <span>{releasedPct.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="border-b border-primary-700/60 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-warning-500">
              {t('all_transactions', 'All Transactions')}
            </h2>
            <div className="flex gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('search_txn', 'Search project or talent...')}
                  className="rounded-lg border border-neutral-600/30 bg-primary-700 py-2 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none"
                />
              </div>
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="appearance-none rounded-lg border border-neutral-600/30 bg-primary-700 py-2 pl-3 pr-8 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
                >
                  <option value="">{t('all_types', 'All Types')}</option>
                  <option value="escrow_in">Escrow In</option>
                  <option value="escrow_release">Escrow Release</option>
                  <option value="brd_payment">BRD Payment</option>
                  <option value="prd_payment">PRD Payment</option>
                  <option value="refund">Refund</option>
                  <option value="partial_refund">Partial Refund</option>
                  <option value="revision_fee">Revision Fee</option>
                  <option value="talent_placement_fee">Placement Fee</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-primary-700/60">
              <tr>
                <th className="px-6 py-3 font-medium text-warning-500">{t('type', 'Type')}</th>
                <th className="px-6 py-3 font-medium text-warning-500">
                  {t('col_project', 'Project')}
                </th>
                <th className="px-6 py-3 font-medium text-warning-500">{t('talent', 'Talent')}</th>
                <th className="px-6 py-3 font-medium text-warning-500">{t('amount', 'Amount')}</th>
                <th className="px-6 py-3 font-medium text-warning-500">{t('method', 'Method')}</th>
                <th className="px-6 py-3 font-medium text-warning-500">Status</th>
                <th className="px-6 py-3 font-medium text-warning-500">{t('date', 'Date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {txnQuery.isError ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-error-500">
                    {t('failed_to_load', 'Failed to load')}: {String(txnQuery.error)}
                  </td>
                </tr>
              ) : txnQuery.isLoading ? (
                ['s1', 's2', 's3', 's4', 's5'].map((k) => (
                  <tr key={k}>
                    <td colSpan={7} className="px-6 py-3">
                      <div className="h-4 animate-pulse rounded bg-primary-700" />
                    </td>
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-neutral-300">
                    {t('no_transactions', 'No transactions found')}
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => {
                  const typeConf = TYPE_CONFIG[txn.type]
                  const statusBadge = STATUS_BADGE[txn.status]
                  return (
                    <tr key={txn.id} className="transition-colors hover:bg-primary-700/30">
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            typeConf?.badge ?? 'bg-neutral-500/20 text-neutral-300',
                          )}
                        >
                          {typeConf?.label ?? txn.type}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-neutral-300">{txn.projectTitle}</td>
                      <td className="px-6 py-3 text-neutral-300">
                        {txn.talentName ?? <span className="text-neutral-600">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            'font-semibold',
                            txn.type.includes('refund') ? 'text-error-500' : 'text-warning-500',
                          )}
                        >
                          {txn.type.includes('refund') ? '-' : ''}
                          {formatRpShort(txn.amount)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-xs text-neutral-300">
                        {txn.paymentMethod ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            statusBadge ?? 'bg-neutral-500/20 text-neutral-300',
                          )}
                        >
                          {txn.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-neutral-300">
                        {formatDateShort(txn.createdAt)}
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

function SummaryCard({
  icon,
  label,
  value,
  delta,
}: {
  icon: React.ReactNode
  label: string
  value: string
  delta?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary-700 p-2">{icon}</div>
        <p className="text-xs text-neutral-300">{label}</p>
      </div>
      <p className="mt-3 text-lg font-bold text-warning-500">{value}</p>
      {delta}
    </div>
  )
}
