import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Download, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTransaction } from '@/hooks/use-payments'
import { apiUrl } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/payments/$transactionId')({
  component: TransactionDetailPage,
})

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning-500/20 text-brand-text',
  processing: 'bg-warning-500/15 text-brand-text',
  completed: 'bg-success-500/20 text-success-500',
  failed: 'bg-error-500/20 text-error-500',
  refunded: 'bg-surface-container/60 text-on-surface-muted',
}

function TransactionDetailPage() {
  const { t } = useTranslation('payment')
  const { transactionId } = Route.useParams()
  const { data: txn, isLoading, isError } = useTransaction(transactionId)

  function formatDateLong(dateStr: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr))
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  if (isError || !txn) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 bg-surface">
        <FileText className="mb-3 h-10 w-10 text-on-surface-muted" />
        <h2 className="text-lg font-semibold text-brand-text">{t('invoice_not_found')}</h2>
        <Link to="/payments" className="mt-4 text-sm text-success-600 hover:underline">
          {t('payment_history')}
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Navigation */}
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/payments"
            className="inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-brand-text"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('payment_history')}
          </Link>
          {/* PDF invoices exist per milestone; other transaction types have none. */}
          {txn.milestoneId && (
            <button
              type="button"
              onClick={() =>
                window.open(
                  apiUrl(`/api/v1/projects/${txn.projectId}/invoices/${txn.milestoneId}.pdf`),
                  '_blank',
                )
              }
              className="inline-flex items-center gap-2 rounded-lg border border-warning-500/30 px-4 py-2 text-sm font-medium text-brand-text hover:bg-surface-container"
            >
              <Download className="h-4 w-4" />
              {t('download_pdf')}
            </button>
          )}
        </div>

        {/* Receipt card */}
        <div className="overflow-hidden rounded-xl border border-outline-dim/20 bg-surface-bright shadow-lg">
          {/* Header */}
          <div className="border-b border-outline-dim/20 p-8">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container">
                  <FileText className="h-6 w-6 text-brand-text" />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight">
                    <span className="text-brand-text">Kerja</span>
                    <span className="text-accent-coral-600">CUS</span>
                    <span className="text-brand-text">!</span>
                  </h1>
                  <p className="text-xs text-on-surface-muted">{t('brand_tagline')}</p>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-semibold text-brand-text">{t('invoice')}</h2>
                <span
                  className={cn(
                    'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    STATUS_BADGE[txn.status] ?? 'bg-surface-container/60 text-on-surface-muted',
                  )}
                >
                  {t(`status_${txn.status}`, txn.status)}
                </span>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="border-b border-outline-dim/20 px-8 py-6">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('reference')}
                </p>
                <p className="mt-1 break-all text-sm font-semibold text-brand-text">
                  {txn.paymentGatewayRef ?? txn.idempotencyKey}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('date')}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">
                  {formatDateLong(txn.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('project')}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">{txn.projectTitle}</p>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="border-b border-outline-dim/20 px-8 py-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('type')}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">
                  {t(txn.type, txn.type)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('total')}
                </p>
                <p className="mt-1 text-2xl font-bold text-brand-text">
                  {formatCurrency(txn.amount)}
                </p>
              </div>
            </div>
          </div>

          {/* Event timeline */}
          {txn.events.length > 0 && (
            <div className="border-b border-outline-dim/20 px-8 py-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                {t('timeline')}
              </p>
              <ul className="space-y-2">
                {txn.events.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between text-sm">
                    <span className="text-on-surface-muted">
                      {ev.eventType}
                      {ev.previousStatus ? ` (${ev.previousStatus} → ${ev.newStatus})` : ''}
                    </span>
                    <span className="text-xs text-on-surface-muted">
                      {formatDateLong(ev.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ledger entries: the double-entry proof of the money movement */}
          {txn.ledgerEntries.length > 0 && (
            <div className="px-8 py-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                {t('ledger_entries')}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-dim/20">
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                      {t('description')}
                    </th>
                    <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                      {t('debit')}
                    </th>
                    <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                      {t('credit')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-primary-700/30">
                  {txn.ledgerEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2 text-on-surface-muted">{entry.description ?? '-'}</td>
                      <td className="py-2 text-right font-medium text-brand-text">
                        {entry.entryType === 'debit' ? formatCurrency(entry.amount) : '-'}
                      </td>
                      <td className="py-2 text-right font-medium text-brand-text">
                        {entry.entryType === 'credit' ? formatCurrency(entry.amount) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Payment method */}
          <div className="border-t border-outline-dim/20 px-8 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-muted">{t('payment_method')}</span>
              <span className="text-xs font-medium text-on-surface-muted">
                {txn.paymentMethod ?? '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
