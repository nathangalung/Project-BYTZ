import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRight,
  ChevronDown,
  DollarSign,
  Download,
  FileText,
  Lock,
  RotateCcw,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/finance')({
  component: AdminFinancePage,
})

type Transaction = {
  id: string
  type:
    | 'escrow_in'
    | 'escrow_release'
    | 'brd_payment'
    | 'prd_payment'
    | 'refund'
    | 'partial_refund'
    | 'revision_fee'
    | 'talent_placement_fee'
  projectTitle: string
  projectId: string
  workerName: string | null
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'
  paymentMethod: string
  gatewayRef: string
  date: string
  canRefund: boolean
}

type EscrowProject = {
  projectId: string
  projectTitle: string
  totalEscrow: number
  released: number
  remaining: number
  status: string
}

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 't1',
    type: 'escrow_in',
    projectTitle: 'E-commerce UMKM',
    projectId: 'p1',
    workerName: null,
    amount: 72000000,
    status: 'completed',
    paymentMethod: 'Bank Transfer BCA',
    gatewayRef: 'MID-2026031401',
    date: '2026-03-14T10:00:00Z',
    canRefund: false,
  },
  {
    id: 't2',
    type: 'escrow_release',
    projectTitle: 'E-commerce UMKM',
    projectId: 'p1',
    workerName: 'Gunawan H.',
    amount: 12000000,
    status: 'completed',
    paymentMethod: 'Platform',
    gatewayRef: 'REL-2026031301',
    date: '2026-03-13T14:00:00Z',
    canRefund: false,
  },
  {
    id: 't3',
    type: 'brd_payment',
    projectTitle: 'Dashboard Analytics',
    projectId: 'p3',
    workerName: null,
    amount: 2500000,
    status: 'completed',
    paymentMethod: 'GoPay',
    gatewayRef: 'MID-2026031201',
    date: '2026-03-12T09:00:00Z',
    canRefund: true,
  },
  {
    id: 't4',
    type: 'refund',
    projectTitle: 'Social Media App',
    projectId: 'p9',
    workerName: null,
    amount: 15000000,
    status: 'processing',
    paymentMethod: 'Bank Transfer BCA',
    gatewayRef: 'REF-2026031101',
    date: '2026-03-11T16:00:00Z',
    canRefund: false,
  },
  {
    id: 't5',
    type: 'escrow_release',
    projectTitle: 'E-commerce UMKM',
    projectId: 'p1',
    workerName: 'Siti Rahayu',
    amount: 18000000,
    status: 'completed',
    paymentMethod: 'Platform',
    gatewayRef: 'REL-2026031002',
    date: '2026-03-10T11:00:00Z',
    canRefund: false,
  },
  {
    id: 't6',
    type: 'prd_payment',
    projectTitle: 'Sistem Inventori',
    projectId: 'p5',
    workerName: null,
    amount: 5500000,
    status: 'completed',
    paymentMethod: 'QRIS',
    gatewayRef: 'MID-2026030901',
    date: '2026-03-09T08:00:00Z',
    canRefund: true,
  },
  {
    id: 't7',
    type: 'escrow_in',
    projectTitle: 'Mobile Fitness App',
    projectId: 'p8',
    workerName: null,
    amount: 85000000,
    status: 'completed',
    paymentMethod: 'Bank Transfer Mandiri',
    gatewayRef: 'MID-2026030801',
    date: '2026-03-08T13:00:00Z',
    canRefund: false,
  },
  {
    id: 't8',
    type: 'revision_fee',
    projectTitle: 'E-commerce UMKM',
    projectId: 'p1',
    workerName: 'Eko Prasetyo',
    amount: 3600000,
    status: 'completed',
    paymentMethod: 'Dana',
    gatewayRef: 'MID-2026030701',
    date: '2026-03-07T10:00:00Z',
    canRefund: true,
  },
  {
    id: 't9',
    type: 'escrow_release',
    projectTitle: 'Dashboard Analytics',
    projectId: 'p3',
    workerName: 'Irfan Maulana',
    amount: 20000000,
    status: 'completed',
    paymentMethod: 'Platform',
    gatewayRef: 'REL-2026030601',
    date: '2026-03-06T15:00:00Z',
    canRefund: false,
  },
  {
    id: 't10',
    type: 'refund',
    projectTitle: 'Landing Page Produk',
    projectId: 'p6',
    workerName: null,
    amount: 5000000,
    status: 'completed',
    paymentMethod: 'Bank Transfer BCA',
    gatewayRef: 'REF-2026030501',
    date: '2026-03-05T09:00:00Z',
    canRefund: false,
  },
  {
    id: 't11',
    type: 'partial_refund',
    projectTitle: 'Chatbot CS AI',
    projectId: 'p7',
    workerName: null,
    amount: 8000000,
    status: 'processing',
    paymentMethod: 'Bank Transfer BNI',
    gatewayRef: 'REF-2026030401',
    date: '2026-03-04T11:00:00Z',
    canRefund: false,
  },
  {
    id: 't12',
    type: 'talent_placement_fee',
    projectTitle: 'Dashboard Analytics',
    projectId: 'p3',
    workerName: 'Irfan Maulana',
    amount: 24000000,
    status: 'completed',
    paymentMethod: 'Bank Transfer BCA',
    gatewayRef: 'MID-2026030301',
    date: '2026-03-03T14:00:00Z',
    canRefund: false,
  },
]

const MOCK_ESCROW: EscrowProject[] = [
  {
    projectId: 'p1',
    projectTitle: 'E-commerce UMKM',
    totalEscrow: 72000000,
    released: 30000000,
    remaining: 42000000,
    status: 'in_progress',
  },
  {
    projectId: 'p8',
    projectTitle: 'Mobile Fitness App',
    totalEscrow: 85000000,
    released: 70000000,
    remaining: 15000000,
    status: 'review',
  },
  {
    projectId: 'p7',
    projectTitle: 'Chatbot CS AI',
    totalEscrow: 28000000,
    released: 10000000,
    remaining: 18000000,
    status: 'disputed',
  },
]

const TYPE_CONFIG: Record<string, { badge: string; label: string }> = {
  escrow_in: { badge: 'bg-success-500/20 text-success-500', label: 'Escrow In' },
  escrow_release: { badge: 'bg-success-500/15 text-success-500', label: 'Escrow Release' },
  brd_payment: { badge: 'bg-warning-500/20 text-warning-500', label: 'BRD Payment' },
  prd_payment: { badge: 'bg-warning-500/20 text-warning-500', label: 'PRD Payment' },
  refund: { badge: 'bg-error-500/20 text-error-500', label: 'Refund' },
  partial_refund: { badge: 'bg-error-500/15 text-error-500', label: 'Partial Refund' },
  revision_fee: { badge: 'bg-warning-500/25 text-warning-500', label: 'Revision Fee' },
  talent_placement_fee: { badge: 'bg-success-500/25 text-success-500', label: 'Placement Fee' },
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-success-500/20 text-success-500',
  processing: 'bg-warning-500/20 text-warning-500',
  pending: 'bg-neutral-500/20 text-neutral-300',
  failed: 'bg-error-500/20 text-error-500',
  refunded: 'bg-error-500/15 text-error-500',
}

function AdminFinancePage() {
  const { t } = useTranslation('admin')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
  const formatRpShort = (n: number) => {
    if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
    return formatRp(n)
  }

  const revenue = {
    total: 850000000,
    thisMonth: 125000000,
    lastMonth: 98000000,
    brd: 45000000,
    prd: 78000000,
    projectMargin: 680000000,
    escrowHeld: MOCK_ESCROW.reduce((sum, e) => sum + e.remaining, 0),
  }

  const revenueChange = ((revenue.thisMonth - revenue.lastMonth) / revenue.lastMonth) * 100

  const filteredTransactions = MOCK_TRANSACTIONS.filter((txn) => {
    const matchesType = !typeFilter || txn.type === typeFilter
    const matchesSearch =
      !searchQuery ||
      txn.projectTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (txn.workerName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    return matchesType && matchesSearch
  })

  function handleRefund(txnId: string) {
    console.log('Process refund:', txnId)
  }

  function handleExportCSV() {
    console.log('Export CSV')
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
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-primary-700"
        >
          <Download className="h-4 w-4" />
          {t('export_csv', 'Export CSV')}
        </button>
      </div>

      {/* Revenue cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-700 p-2">
              <DollarSign className="h-5 w-5 text-success-500" />
            </div>
            <p className="text-xs text-neutral-300">{t('total_revenue', 'Total Revenue')}</p>
          </div>
          <p className="mt-3 text-lg font-bold text-warning-500">{formatRpShort(revenue.total)}</p>
          <div className="mt-1 flex items-center gap-1 text-xs text-success-500">
            <ArrowUpRight className="h-3 w-3" />
            <span>+27.6%</span>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-700 p-2">
              <TrendingUp className="h-5 w-5 text-success-500" />
            </div>
            <p className="text-xs text-neutral-300">{t('this_month_revenue', 'This Month')}</p>
          </div>
          <p className="mt-3 text-lg font-bold text-warning-500">
            {formatRpShort(revenue.thisMonth)}
          </p>
          <div className="mt-1 flex items-center gap-1 text-xs text-success-500">
            <ArrowUpRight className="h-3 w-3" />
            <span>+{revenueChange.toFixed(1)}%</span>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-700 p-2">
              <FileText className="h-5 w-5 text-warning-500" />
            </div>
            <p className="text-xs text-neutral-300">BRD</p>
          </div>
          <p className="mt-3 text-lg font-bold text-warning-500">{formatRpShort(revenue.brd)}</p>
        </div>
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-700 p-2">
              <FileText className="h-5 w-5 text-warning-500" />
            </div>
            <p className="text-xs text-neutral-300">PRD</p>
          </div>
          <p className="mt-3 text-lg font-bold text-warning-500">{formatRpShort(revenue.prd)}</p>
        </div>
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-700 p-2">
              <DollarSign className="h-5 w-5 text-success-500" />
            </div>
            <p className="text-xs text-neutral-300">{t('project_margin', 'Project Margin')}</p>
          </div>
          <p className="mt-3 text-lg font-bold text-warning-500">
            {formatRpShort(revenue.projectMargin)}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-700 p-2">
              <Wallet className="h-5 w-5 text-error-500" />
            </div>
            <p className="text-xs text-neutral-300">{t('escrow_held', 'Escrow Held')}</p>
          </div>
          <p className="mt-3 text-lg font-bold text-warning-500">
            {formatRpShort(revenue.escrowHeld)}
          </p>
          <div className="mt-1 flex items-center gap-1 text-xs text-error-500">
            <Lock className="h-3 w-3" />
            <span>{t('frozen_funds', 'Frozen funds')}</span>
          </div>
        </div>
      </div>

      {/* Escrow breakdown */}
      <div className="mt-8 rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="border-b border-primary-700/60 px-6 py-4">
          <h2 className="text-lg font-semibold text-warning-500">
            {t('escrow_by_project', 'Escrow by Active Project')}
          </h2>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {MOCK_ESCROW.map((esc) => {
              const releasedPct = (esc.released / esc.totalEscrow) * 100
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
        </div>
      </div>

      {/* Transactions table */}
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
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search_txn', 'Search project...')}
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
                <th className="px-6 py-3 font-medium text-warning-500">
                  {t('col_actions', 'Actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-neutral-300">
                    {t('no_transactions', 'No transactions found')}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((txn) => {
                  const typeConf = TYPE_CONFIG[txn.type]
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
                        {txn.workerName ?? <span className="text-neutral-600">-</span>}
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
                        {txn.paymentMethod}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            STATUS_BADGE[txn.status] ?? 'bg-neutral-500/20 text-neutral-300',
                          )}
                        >
                          {txn.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-neutral-300">
                        {formatDateShort(txn.date)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        {txn.canRefund && txn.status === 'completed' && (
                          <button
                            type="button"
                            onClick={() => handleRefund(txn.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-error-500/50 px-2.5 py-1 text-xs font-medium text-error-500 hover:bg-error-500/10"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t('refund', 'Refund')}
                          </button>
                        )}
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
