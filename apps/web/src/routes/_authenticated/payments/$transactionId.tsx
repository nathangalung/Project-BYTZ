import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Download, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTransaction } from '@/hooks/use-payments'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/payments/$transactionId')({
  component: InvoiceViewerPage,
})

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning-500/20 text-primary-600',
  processing: 'bg-warning-500/15 text-primary-600',
  completed: 'bg-success-500/20 text-success-500',
  failed: 'bg-error-500/20 text-error-500',
  refunded: 'bg-neutral-500/20 text-on-surface-muted',
}

function InvoiceViewerPage() {
  const { t } = useTranslation('payment')
  const { transactionId } = Route.useParams()
  const { data: invoice, isLoading, isError } = useTransaction(transactionId)

  function formatRp(n: number) {
    return `Rp ${n.toLocaleString('id-ID')}`
  }

  function formatDateLong(dateStr: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(dateStr))
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  if (isError || !invoice) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 bg-surface">
        <FileText className="mb-3 h-10 w-10 text-on-surface-muted" />
        <h2 className="text-lg font-semibold text-primary-600">
          {t('invoice_not_found', 'Invoice tidak ditemukan')}
        </h2>
        <Link to="/payments" className="mt-4 text-sm text-success-600 hover:underline">
          {t('payment_history', 'Riwayat Pembayaran')}
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
            className="inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('payment_history', 'Riwayat Pembayaran')}
          </Link>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-warning-500/30 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-surface-container"
          >
            <Download className="h-4 w-4" />
            {t('download_pdf', 'Download PDF')}
          </button>
        </div>

        {/* Invoice card */}
        <div className="overflow-hidden rounded-xl border border-outline-dim/20 bg-surface-bright shadow-lg">
          {/* Header */}
          <div className="border-b border-outline-dim/20 p-8">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container">
                  <FileText className="h-6 w-6 text-primary-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight">
                    <span className="text-primary-600">Kerja</span>
                    <span className="text-accent-coral-600">CUS</span>
                    <span className="text-primary-600">!</span>
                  </h1>
                  <p className="text-xs text-on-surface-muted">Virtual Software House</p>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-semibold text-primary-600">
                  {t('invoice', 'Invoice')}
                </h2>
                <span
                  className={cn(
                    'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    STATUS_BADGE[invoice.status] ?? 'bg-neutral-500/20 text-on-surface-muted',
                  )}
                >
                  {t(`status_${invoice.status}`, invoice.status)}
                </span>
              </div>
            </div>
          </div>

          {/* Invoice meta */}
          <div className="border-b border-outline-dim/20 px-8 py-6">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('invoice_number', 'No. Invoice')}
                </p>
                <p className="mt-1 text-sm font-semibold text-primary-600">
                  {invoice.invoiceNumber}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('invoice_date', 'Tanggal')}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">
                  {formatDateLong(invoice.date)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('project', 'Proyek')}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">{invoice.projectTitle}</p>
              </div>
            </div>
          </div>

          {/* From / To */}
          <div className="border-b border-outline-dim/20 px-8 py-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('from', 'Dari')}
                </p>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-on-surface">{invoice.from.name}</p>
                  <p className="mt-0.5 text-xs text-on-surface-muted">{invoice.from.address}</p>
                  <p className="text-xs text-on-surface-muted">{invoice.from.email}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                  {t('to', 'Kepada')}
                </p>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-on-surface">{invoice.to.name}</p>
                  <p className="mt-0.5 text-xs text-on-surface-muted">{invoice.to.address}</p>
                  <p className="text-xs text-on-surface-muted">{invoice.to.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="px-8 py-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-dim/20">
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                    {t('description', 'Deskripsi')}
                  </th>
                  <th className="pb-3 text-center text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                    {t('quantity', 'Qty')}
                  </th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wider text-on-surface-muted">
                    {t('amount', 'Jumlah')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary-700/30">
                {invoice.items.map((item) => (
                  <tr key={item.description}>
                    <td className="py-3 text-on-surface-muted">{item.description}</td>
                    <td className="py-3 text-center text-on-surface-muted">{item.quantity}</td>
                    <td className="py-3 text-right font-medium text-primary-600">
                      {formatRp(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-outline-dim/20 px-8 py-6">
            <div className="ml-auto max-w-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-muted">{t('subtotal', 'Subtotal')}</span>
                <span className="text-sm font-medium text-on-surface-muted">
                  {formatRp(invoice.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-outline-dim/20 pt-3">
                <span className="text-base font-semibold text-primary-600">
                  {t('total', 'Total')}
                </span>
                <span className="text-2xl font-bold text-primary-600">
                  {formatRp(invoice.total)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment method */}
          <div className="border-t border-outline-dim/20 px-8 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-muted">
                {t('payment_method', 'Metode Pembayaran')}
              </span>
              <span className="text-xs font-medium text-on-surface-muted">
                {invoice.paymentMethod}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
