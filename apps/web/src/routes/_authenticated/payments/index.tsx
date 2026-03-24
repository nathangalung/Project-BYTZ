import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CalendarDays,
  Clock,
  Download,
  FileText,
  Loader2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePaymentHistory, usePaymentSummary } from '@/hooks/use-payments'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/payments/')({
  component: PaymentHistoryPage,
})

const TYPE_FILTERS = [
  'all',
  'escrow_in',
  'escrow_release',
  'brd_payment',
  'prd_payment',
  'refund',
] as const

const TYPE_BADGE: Record<string, string> = {
  escrow_in: 'bg-success-500/20 text-success-600',
  escrow_release: 'bg-success-500/15 text-success-600',
  brd_payment: 'bg-warning-500/20 text-primary-600',
  prd_payment: 'bg-warning-500/20 text-primary-600',
  refund: 'bg-error-500/20 text-error-600',
  partial_refund: 'bg-error-500/20 text-error-600',
  revision_fee: 'bg-warning-500/20 text-primary-600',
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning-500/20 text-primary-600',
  processing: 'bg-warning-500/15 text-primary-600',
  completed: 'bg-success-500/20 text-success-600',
  failed: 'bg-error-500/20 text-error-600',
  refunded: 'bg-neutral-500/20 text-on-surface-muted',
}

function PaymentHistoryPage() {
  const { t } = useTranslation('payment')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const { data: historyData, isLoading: historyLoading } = usePaymentHistory({
    type: typeFilter === 'all' ? undefined : typeFilter,
    page: 1,
    pageSize: 50,
  })
  const { data: summaryData, isLoading: summaryLoading } = usePaymentSummary()

  const filtered = historyData?.items ?? []
  const isLoading = historyLoading || summaryLoading

  const summary = {
    totalSpent: summaryData?.totalSpent ?? 0,
    pending: summaryData?.pending ?? 0,
    thisMonth: summaryData?.thisMonth ?? 0,
    totalTransactions: historyData?.total ?? 0,
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
    <div className="bg-surface p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-primary-600">
          {t('payment_history', 'Riwayat Pembayaran')}
        </h1>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container"
        >
          <Download className="h-4 w-4" />
          {t('export_csv', 'Export CSV')}
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<ArrowUpRight className="h-5 w-5 text-error-600" />}
          label={t('total_spent', 'Total Pengeluaran')}
          value={formatRp(summary.totalSpent)}
        />
        <SummaryCard
          icon={<Clock className="h-5 w-5 text-primary-600" />}
          label={t('pending', 'Pending')}
          value={formatRp(summary.pending)}
        />
        <SummaryCard
          icon={<CalendarDays className="h-5 w-5 text-success-600" />}
          label={t('this_month', 'Bulan Ini')}
          value={formatRp(summary.thisMonth)}
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5 text-primary-600" />}
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
                ? 'bg-primary-600 text-white'
                : 'bg-surface-container text-on-surface-muted hover:bg-surface-container/80 hover:text-on-surface-muted',
            )}
          >
            {filter === 'all' ? t('all_types', 'Semua') : t(filter, filter.replace(/_/g, ' '))}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <div className="overflow-hidden rounded-xl border border-outline-dim/20 bg-surface-bright">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-success-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Wallet className="mb-3 h-8 w-8 text-on-surface-muted" />
            <p className="text-sm font-medium text-on-surface-muted">
              {t('no_transactions', 'Belum ada transaksi')}
            </p>
            <p className="mt-1 text-xs text-on-surface-muted">
              {t('no_transactions_description', 'Transaksi akan muncul di sini')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-outline-dim/20">
                <tr>
                  <th className="px-6 py-3 font-medium text-primary-600">{t('date', 'Tanggal')}</th>
                  <th className="px-6 py-3 font-medium text-primary-600">
                    {t('description', 'Deskripsi')}
                  </th>
                  <th className="px-6 py-3 font-medium text-primary-600">{t('type', 'Tipe')}</th>
                  <th className="px-6 py-3 font-medium text-primary-600">
                    {t('amount', 'Jumlah')}
                  </th>
                  <th className="px-6 py-3 font-medium text-primary-600">
                    {t('status', 'Status')}
                  </th>
                  <th className="px-6 py-3 font-medium text-primary-600">{t('actions', 'Aksi')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-dim/10">
                {filtered.map((txn) => {
                  const isIncoming = txn.type === 'escrow_release' || txn.type === 'refund'
                  return (
                    <tr key={txn.id} className="transition-colors hover:bg-surface-container/30">
                      <td className="whitespace-nowrap px-6 py-3 text-on-surface-muted">
                        {formatDateShort(txn.createdAt)}
                      </td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-on-surface">{txn.projectTitle}</p>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            TYPE_BADGE[txn.type] ?? 'bg-neutral-500/20 text-on-surface-muted',
                          )}
                        >
                          {t(txn.type, txn.type.replace(/_/g, ' '))}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            'font-semibold',
                            isIncoming ? 'text-success-600' : 'text-primary-600',
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
                            STATUS_BADGE[txn.status] ?? 'bg-neutral-500/20 text-on-surface-muted',
                          )}
                        >
                          {t(`status_${txn.status}`, txn.status)}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <Link
                          to="/payments/$transactionId"
                          params={{ transactionId: txn.id }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-success-600 hover:underline"
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
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-5">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-surface-container p-2.5">{icon}</div>
        <div>
          <p className="text-sm text-on-surface-muted">{label}</p>
          <p className="text-xl font-bold text-primary-600">{value}</p>
        </div>
      </div>
    </div>
  )
}
