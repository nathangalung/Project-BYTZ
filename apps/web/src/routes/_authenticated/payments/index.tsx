import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CalendarDays,
  Clock,
  Download,
  FileText,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/payments/')({
  component: PaymentHistoryPage,
})

type Transaction = {
  id: string
  type: string
  projectTitle: string
  amount: number
  status: string
  createdAt: string
}

const TYPE_FILTERS = [
  'all',
  'escrow_in',
  'escrow_release',
  'brd_payment',
  'prd_payment',
  'refund',
] as const

const TYPE_BADGE: Record<string, string> = {
  escrow_in: 'bg-success-500/20 text-success-500',
  escrow_release: 'bg-success-500/15 text-success-500',
  brd_payment: 'bg-warning-500/20 text-warning-500',
  prd_payment: 'bg-warning-500/20 text-warning-500',
  refund: 'bg-error-500/20 text-error-500',
  partial_refund: 'bg-error-500/20 text-error-500',
  revision_fee: 'bg-warning-500/20 text-warning-500',
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning-500/20 text-warning-500',
  processing: 'bg-warning-500/15 text-warning-500',
  completed: 'bg-success-500/20 text-success-500',
  failed: 'bg-error-500/20 text-error-500',
  refunded: 'bg-neutral-500/20 text-neutral-400',
}

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 't1',
    type: 'escrow_in',
    projectTitle: 'E-commerce Platform UMKM',
    amount: 55000000,
    status: 'completed',
    createdAt: '2026-03-14T10:30:00Z',
  },
  {
    id: 't2',
    type: 'escrow_release',
    projectTitle: 'Mobile Booking App',
    amount: 8000000,
    status: 'completed',
    createdAt: '2026-03-13T15:00:00Z',
  },
  {
    id: 't3',
    type: 'brd_payment',
    projectTitle: 'Dashboard Analytics',
    amount: 2500000,
    status: 'completed',
    createdAt: '2026-03-12T09:00:00Z',
  },
  {
    id: 't4',
    type: 'refund',
    projectTitle: 'Social Media App',
    amount: 15000000,
    status: 'processing',
    createdAt: '2026-03-11T14:00:00Z',
  },
  {
    id: 't5',
    type: 'escrow_release',
    projectTitle: 'E-commerce Platform UMKM',
    amount: 12000000,
    status: 'completed',
    createdAt: '2026-03-10T11:30:00Z',
  },
  {
    id: 't6',
    type: 'prd_payment',
    projectTitle: 'Sistem Inventori',
    amount: 5500000,
    status: 'completed',
    createdAt: '2026-03-09T16:00:00Z',
  },
  {
    id: 't7',
    type: 'escrow_in',
    projectTitle: 'Mobile Fitness App',
    amount: 85000000,
    status: 'completed',
    createdAt: '2026-03-08T08:30:00Z',
  },
  {
    id: 't8',
    type: 'revision_fee',
    projectTitle: 'E-commerce Platform UMKM',
    amount: 3600000,
    status: 'completed',
    createdAt: '2026-03-07T13:00:00Z',
  },
  {
    id: 't9',
    type: 'escrow_release',
    projectTitle: 'Dashboard Analytics',
    amount: 20000000,
    status: 'completed',
    createdAt: '2026-03-06T10:00:00Z',
  },
  {
    id: 't10',
    type: 'refund',
    projectTitle: 'Landing Page Produk',
    amount: 5000000,
    status: 'completed',
    createdAt: '2026-03-05T12:00:00Z',
  },
]

function PaymentHistoryPage() {
  const { t } = useTranslation('payment')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const filtered =
    typeFilter === 'all'
      ? MOCK_TRANSACTIONS
      : MOCK_TRANSACTIONS.filter((txn) => txn.type === typeFilter)

  const summary = {
    totalSpent: 211600000,
    pending: 15000000,
    thisMonth: 86000000,
    totalTransactions: MOCK_TRANSACTIONS.length,
  }

  function formatRp(n: number) {
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
    return `Rp ${n.toLocaleString('id-ID')}`
  }

  function formatDateShort(dateStr: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateStr))
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-warning-500">
          {t('payment_history', 'Riwayat Pembayaran')}
        </h1>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-400 hover:bg-primary-700"
        >
          <Download className="h-4 w-4" />
          {t('export_csv', 'Export CSV')}
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<ArrowUpRight className="h-5 w-5 text-error-500" />}
          label={t('total_spent', 'Total Pengeluaran')}
          value={formatRp(summary.totalSpent)}
        />
        <SummaryCard
          icon={<Clock className="h-5 w-5 text-warning-500" />}
          label={t('pending', 'Pending')}
          value={formatRp(summary.pending)}
        />
        <SummaryCard
          icon={<CalendarDays className="h-5 w-5 text-success-500" />}
          label={t('this_month', 'Bulan Ini')}
          value={formatRp(summary.thisMonth)}
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5 text-warning-500" />}
          label={t('total_transactions', 'Total Transaksi')}
          value={String(summary.totalTransactions)}
        />
      </div>

      {/* Type filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TYPE_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter}
            onClick={() => setTypeFilter(filter)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
              typeFilter === filter
                ? 'bg-success-500 text-primary-800'
                : 'bg-primary-700 text-neutral-400 hover:bg-primary-700/80 hover:text-neutral-300',
            )}
          >
            {filter === 'all' ? t('all_types', 'Semua') : t(filter, filter.replace(/_/g, ' '))}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Wallet className="mb-3 h-8 w-8 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-500">
              {t('no_transactions', 'Belum ada transaksi')}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              {t('no_transactions_description', 'Transaksi akan muncul di sini')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-primary-700/60">
                <tr>
                  <th className="px-6 py-3 font-medium text-warning-500">{t('date', 'Tanggal')}</th>
                  <th className="px-6 py-3 font-medium text-warning-500">
                    {t('description', 'Deskripsi')}
                  </th>
                  <th className="px-6 py-3 font-medium text-warning-500">{t('type', 'Tipe')}</th>
                  <th className="px-6 py-3 font-medium text-warning-500">
                    {t('amount', 'Jumlah')}
                  </th>
                  <th className="px-6 py-3 font-medium text-warning-500">
                    {t('status', 'Status')}
                  </th>
                  <th className="px-6 py-3 font-medium text-warning-500">{t('actions', 'Aksi')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary-700/40">
                {filtered.map((txn) => {
                  const isIncoming = txn.type === 'escrow_release' || txn.type === 'refund'
                  return (
                    <tr key={txn.id} className="transition-colors hover:bg-primary-700/30">
                      <td className="whitespace-nowrap px-6 py-3 text-neutral-500">
                        {formatDateShort(txn.createdAt)}
                      </td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-neutral-200">{txn.projectTitle}</p>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            TYPE_BADGE[txn.type] ?? 'bg-neutral-500/20 text-neutral-400',
                          )}
                        >
                          {t(txn.type, txn.type.replace(/_/g, ' '))}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            'font-semibold',
                            isIncoming ? 'text-success-500' : 'text-warning-500',
                          )}
                        >
                          {isIncoming ? '+' : '-'}
                          {formatRp(txn.amount)}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            STATUS_BADGE[txn.status] ?? 'bg-neutral-500/20 text-neutral-400',
                          )}
                        >
                          {t(`status_${txn.status}`, txn.status)}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <Link
                          to="/payments/$transactionId"
                          params={{ transactionId: txn.id }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-success-500 hover:text-success-500/80"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {t('view_invoice', 'Invoice')}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-5">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-primary-700 p-2.5">{icon}</div>
        <div>
          <p className="text-sm text-neutral-500">{label}</p>
          <p className="text-xl font-bold text-warning-500">{value}</p>
        </div>
      </div>
    </div>
  )
}
