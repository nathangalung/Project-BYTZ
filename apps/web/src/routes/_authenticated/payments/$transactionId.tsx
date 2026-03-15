import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Download, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/payments/$transactionId')({
  component: InvoiceViewerPage,
})

const MOCK_INVOICES: Record<
  string,
  {
    id: string
    invoiceNumber: string
    status: string
    date: string
    projectTitle: string
    from: { name: string; address: string; email: string }
    to: { name: string; address: string; email: string }
    items: { description: string; quantity: number; amount: number }[]
    subtotal: number
    platformFee: number
    total: number
    paymentMethod: string
  }
> = {
  t1: {
    id: 't1',
    invoiceNumber: 'INV-2026-001',
    status: 'completed',
    date: '2026-03-14T10:30:00Z',
    projectTitle: 'E-commerce Platform UMKM',
    from: {
      name: 'PT BYTZ Teknologi Indonesia',
      address: 'Jl. Sudirman No. 123, Jakarta Selatan 12190',
      email: 'billing@bytz.io',
    },
    to: {
      name: 'Ahmad Budiman',
      address: 'Jl. Merdeka No. 45, Bandung 40115',
      email: 'ahmad.budiman@example.com',
    },
    items: [
      {
        description: 'Escrow Deposit - Milestone 1: Backend API Development',
        quantity: 1,
        amount: 25000000,
      },
      {
        description: 'Escrow Deposit - Milestone 2: Frontend Integration',
        quantity: 1,
        amount: 20000000,
      },
      {
        description: 'Escrow Deposit - Milestone 3: Testing & Deployment',
        quantity: 1,
        amount: 10000000,
      },
    ],
    subtotal: 55000000,
    platformFee: 8250000,
    total: 55000000,
    paymentMethod: 'Bank Transfer - BCA',
  },
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning-500/20 text-warning-500',
  processing: 'bg-warning-500/15 text-warning-500',
  completed: 'bg-success-500/20 text-success-500',
  failed: 'bg-error-500/20 text-error-500',
  refunded: 'bg-neutral-500/20 text-neutral-400',
}

function InvoiceViewerPage() {
  const { t } = useTranslation('payment')
  const { transactionId } = Route.useParams()

  const invoice = MOCK_INVOICES[transactionId] ?? MOCK_INVOICES.t1

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

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Navigation */}
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/payments"
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-success-500"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('payment_history', 'Riwayat Pembayaran')}
          </Link>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-warning-500/30 px-4 py-2 text-sm font-medium text-warning-500 hover:bg-primary-700"
          >
            <Download className="h-4 w-4" />
            {t('download_pdf', 'Download PDF')}
          </button>
        </div>

        {/* Invoice card */}
        <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600 shadow-lg">
          {/* Header */}
          <div className="border-b border-primary-700/60 p-8">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-700">
                  <FileText className="h-6 w-6 text-warning-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-warning-500">BYTZ</h1>
                  <p className="text-xs text-neutral-500">Virtual Software House</p>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-semibold text-warning-500">
                  {t('invoice', 'Invoice')}
                </h2>
                <span
                  className={cn(
                    'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    STATUS_BADGE[invoice.status] ?? 'bg-neutral-500/20 text-neutral-400',
                  )}
                >
                  {t(`status_${invoice.status}`, invoice.status)}
                </span>
              </div>
            </div>
          </div>

          {/* Invoice meta */}
          <div className="border-b border-primary-700/60 px-8 py-6">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-600">
                  {t('invoice_number', 'No. Invoice')}
                </p>
                <p className="mt-1 text-sm font-semibold text-warning-500">
                  {invoice.invoiceNumber}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-600">
                  {t('invoice_date', 'Tanggal')}
                </p>
                <p className="mt-1 text-sm font-semibold text-neutral-200">
                  {formatDateLong(invoice.date)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-600">
                  {t('project', 'Proyek')}
                </p>
                <p className="mt-1 text-sm font-semibold text-neutral-200">
                  {invoice.projectTitle}
                </p>
              </div>
            </div>
          </div>

          {/* From / To */}
          <div className="border-b border-primary-700/60 px-8 py-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-600">
                  {t('from', 'Dari')}
                </p>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-neutral-200">{invoice.from.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{invoice.from.address}</p>
                  <p className="text-xs text-neutral-500">{invoice.from.email}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-600">
                  {t('to', 'Kepada')}
                </p>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-neutral-200">{invoice.to.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{invoice.to.address}</p>
                  <p className="text-xs text-neutral-500">{invoice.to.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="px-8 py-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary-700/60">
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wider text-neutral-600">
                    {t('description', 'Deskripsi')}
                  </th>
                  <th className="pb-3 text-center text-xs font-medium uppercase tracking-wider text-neutral-600">
                    {t('quantity', 'Qty')}
                  </th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wider text-neutral-600">
                    {t('amount', 'Jumlah')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary-700/30">
                {invoice.items.map((item) => (
                  <tr key={item.description}>
                    <td className="py-3 text-neutral-300">{item.description}</td>
                    <td className="py-3 text-center text-neutral-500">{item.quantity}</td>
                    <td className="py-3 text-right font-medium text-warning-500">
                      {formatRp(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-primary-700/60 px-8 py-6">
            <div className="ml-auto max-w-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">{t('subtotal', 'Subtotal')}</span>
                <span className="text-sm font-medium text-neutral-300">
                  {formatRp(invoice.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-primary-700/60 pt-3">
                <span className="text-base font-semibold text-warning-500">
                  {t('total', 'Total')}
                </span>
                <span className="text-2xl font-bold text-warning-500">
                  {formatRp(invoice.total)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment method */}
          <div className="border-t border-primary-700/60 px-8 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-600">
                {t('payment_method', 'Metode Pembayaran')}
              </span>
              <span className="text-xs font-medium text-neutral-400">{invoice.paymentMethod}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
