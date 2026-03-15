import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/checkout')({
  component: CheckoutPage,
})

const PAYMENT_METHODS = [
  {
    id: 'bank_transfer',
    icon: Building2,
    providers: null,
  },
  {
    id: 'qris',
    icon: QrCode,
    providers: null,
  },
  {
    id: 'e_wallet',
    icon: Smartphone,
    providers: ['gopay', 'ovo', 'dana', 'shopeepay'],
  },
] as const

type PaymentMethod = (typeof PAYMENT_METHODS)[number]['id']
type CheckoutState = 'form' | 'waiting' | 'success' | 'error'

const DUMMY_PROJECT = {
  id: 'p1',
  title: 'E-commerce Platform UMKM',
  status: 'prd_approved',
  finalPrice: 72000000,
  budgetMax: 80000000,
}

function CheckoutPage() {
  const { t } = useTranslation('payment')
  const { projectId } = Route.useParams()

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [checkoutState, setCheckoutState] = useState<CheckoutState>('form')

  const project = DUMMY_PROJECT
  const paymentAmount = project.finalPrice ?? project.budgetMax

  const paymentType =
    project.status === 'brd_approved'
      ? 'brd_payment'
      : project.status === 'prd_approved'
        ? 'prd_payment'
        : 'escrow_in'

  const paymentLabel =
    paymentType === 'brd_payment'
      ? t('brd_payment', 'Pembayaran BRD')
      : paymentType === 'prd_payment'
        ? t('prd_payment', 'Pembayaran PRD')
        : t('escrow_in', 'Escrow Deposit')

  function formatRp(n: number) {
    return `Rp ${n.toLocaleString('id-ID')}`
  }

  function handlePay() {
    if (!selectedMethod || !agreedToTerms) return
    setCheckoutState('waiting')
  }

  // Success
  if (checkoutState === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary-600 p-6">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-500/20">
            <CheckCircle2 className="h-8 w-8 text-success-500" />
          </div>
          <h2 className="text-xl font-semibold text-warning-500">
            {t('payment_success', 'Pembayaran Berhasil')}
          </h2>
          <p className="mt-2 text-sm text-neutral-500">
            {t('payment_success_desc', 'Dana escrow telah diterima. Proyek akan segera dimulai.')}
          </p>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-800 hover:bg-success-500/90"
          >
            {t('back_to_project', 'Kembali ke Proyek')}
          </Link>
        </div>
      </div>
    )
  }

  // Waiting
  if (checkoutState === 'waiting') {
    return (
      <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
        <div className="mx-auto max-w-lg">
          <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning-500/20">
              <Clock className="h-8 w-8 text-warning-500" />
            </div>
            <h2 className="text-xl font-semibold text-warning-500">
              {t('waiting_payment', 'Menunggu Pembayaran')}
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              {t('payment_instructions', 'Selesaikan pembayaran sesuai instruksi di bawah ini')}
            </p>

            <div className="mt-6 rounded-lg border border-primary-700/60 bg-primary-700 p-4 text-left">
              <p className="text-sm font-medium text-neutral-300">
                {selectedMethod === 'bank_transfer' &&
                  t(
                    'va_instruction',
                    'Transfer ke Virtual Account yang telah dikirim ke email Anda',
                  )}
                {selectedMethod === 'qris' &&
                  t('qris_instruction', 'Scan QR code di bawah untuk membayar')}
                {selectedMethod === 'e_wallet' &&
                  t('ewallet_instruction', 'Buka aplikasi e-wallet dan selesaikan pembayaran')}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-neutral-500">{t('amount', 'Jumlah')}</span>
                <span className="text-lg font-bold text-warning-500">
                  {formatRp(paymentAmount)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-neutral-500">
                  {t('payment_deadline', 'Batas Waktu')}
                </span>
                <span className="text-sm font-medium text-error-500">24:00:00</span>
              </div>
            </div>

            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setCheckoutState('success')}
                className="rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-800 hover:bg-success-500/90"
              >
                {t('simulate_success', 'Simulasi Berhasil')}
              </button>
              <Link
                to="/projects/$projectId"
                params={{ projectId }}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-600/50 px-5 py-2.5 text-sm font-medium text-neutral-400 hover:bg-primary-700"
              >
                {t('back_to_project', 'Kembali ke Proyek')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error
  if (checkoutState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary-600 p-6">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error-500/20">
            <AlertCircle className="h-8 w-8 text-error-500" />
          </div>
          <h2 className="text-xl font-semibold text-error-500">
            {t('payment_failed', 'Pembayaran Gagal')}
          </h2>
          <button
            type="button"
            onClick={() => setCheckoutState('form')}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-800 hover:bg-success-500/90"
          >
            {t('pay_now', 'Bayar Sekarang')}
          </button>
        </div>
      </div>
    )
  }

  // Main form
  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-success-500"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.title}
        </Link>

        <h1 className="mb-6 text-2xl font-semibold text-warning-500">
          {t('checkout', 'Checkout')}
        </h1>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Payment methods */}
          <div className="space-y-6 lg:col-span-3">
            <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-warning-500">
                <CreditCard className="h-5 w-5 text-neutral-500" />
                {t('payment_method', 'Metode Pembayaran')}
              </h2>

              <div className="space-y-3">
                {PAYMENT_METHODS.map((method) => {
                  const Icon = method.icon
                  const isSelected = selectedMethod === method.id

                  return (
                    <div key={method.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMethod(method.id)
                          if (!method.providers) setSelectedProvider(null)
                        }}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                          isSelected
                            ? 'border-success-500/60 bg-primary-700 ring-1 ring-success-500/30'
                            : 'border-primary-700/60 bg-primary-700 hover:border-neutral-600/50',
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-lg',
                            isSelected ? 'bg-success-500/20' : 'bg-primary-800',
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-5 w-5',
                              isSelected ? 'text-success-500' : 'text-neutral-500',
                            )}
                          />
                        </div>
                        <div className="flex-1">
                          <span
                            className={cn(
                              'text-sm font-medium',
                              isSelected ? 'text-neutral-200' : 'text-neutral-400',
                            )}
                          >
                            {t(method.id, method.id.replace(/_/g, ' '))}
                          </span>
                        </div>
                        <div
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-full border-2',
                            isSelected ? 'border-success-500 bg-success-500' : 'border-neutral-600',
                          )}
                        >
                          {isSelected && <div className="h-2 w-2 rounded-full bg-primary-800" />}
                        </div>
                      </button>

                      {isSelected && method.providers && (
                        <div className="ml-6 mt-2 grid grid-cols-2 gap-2">
                          {method.providers.map((provider) => (
                            <button
                              type="button"
                              key={provider}
                              onClick={() => setSelectedProvider(provider)}
                              className={cn(
                                'rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                                selectedProvider === provider
                                  ? 'border-success-500/50 bg-success-500/10 text-success-500'
                                  : 'border-primary-700/60 bg-primary-800 text-neutral-500 hover:border-neutral-600/50',
                              )}
                            >
                              {t(provider, provider)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Terms */}
            <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-600 bg-primary-700 text-success-500 focus:ring-success-500/30"
                />
                <span className="text-sm text-neutral-400">
                  {t(
                    'agree_terms',
                    'Saya menyetujui syarat dan ketentuan BYTZ serta kebijakan escrow',
                  )}
                </span>
              </label>

              <button
                type="button"
                onClick={handlePay}
                disabled={
                  !selectedMethod ||
                  !agreedToTerms ||
                  (selectedMethod === 'e_wallet' && !selectedProvider)
                }
                className={cn(
                  'mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3.5 text-sm font-bold transition-colors',
                  !selectedMethod ||
                    !agreedToTerms ||
                    (selectedMethod === 'e_wallet' && !selectedProvider)
                    ? 'cursor-not-allowed bg-primary-700 text-neutral-600'
                    : 'bg-success-500 text-primary-800 hover:bg-success-500/90 shadow-lg shadow-success-500/20',
                )}
              >
                <Wallet className="h-4 w-4" />
                {t('pay_now', 'Bayar Sekarang')} - {formatRp(paymentAmount)}
              </button>
            </div>
          </div>

          {/* Order summary */}
          <div className="lg:col-span-2">
            <div className="sticky top-8 rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
              <h2 className="mb-4 text-base font-semibold text-warning-500">
                {t('order_summary', 'Ringkasan Pesanan')}
              </h2>

              <div className="space-y-3">
                <div className="rounded-lg bg-primary-700 p-3">
                  <p className="text-sm font-medium text-neutral-200">{project.title}</p>
                  <p className="mt-1 text-xs text-neutral-500">{paymentLabel}</p>
                </div>

                <div className="border-t border-primary-700/60 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-neutral-500">{t('subtotal', 'Subtotal')}</span>
                    <span className="text-sm font-medium text-neutral-300">
                      {formatRp(paymentAmount)}
                    </span>
                  </div>
                </div>

                <div className="border-t border-primary-700/60 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-warning-500">
                      {t('total', 'Total')}
                    </span>
                    <span className="text-lg font-bold text-warning-500">
                      {formatRp(paymentAmount)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-success-500/10 p-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-500" />
                <p className="text-xs text-success-500">
                  {t(
                    'escrow_description',
                    'Dana Anda dilindungi oleh escrow BYTZ. Pencairan hanya dilakukan setelah milestone di-approve.',
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
