import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCreateSnapToken } from '@/hooks/use-payments'
import { useProject } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

const checkoutSearchSchema = z.object({
  type: z.enum(['brd', 'prd', 'escrow']).optional().default('escrow'),
})

export const Route = createFileRoute('/_authenticated/projects/$projectId/checkout')({
  validateSearch: checkoutSearchSchema,
  component: CheckoutPage,
})

const MIDTRANS_CLIENT_KEY = import.meta.env.VITE_MIDTRANS_CLIENT_KEY ?? ''
const MIDTRANS_SNAP_URL = 'https://app.sandbox.midtrans.com/snap/snap.js'

type CheckoutState = 'form' | 'loading' | 'pending' | 'success' | 'error'

// Extend window for Midtrans Snap global
declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        options: {
          onSuccess?: (result: Record<string, unknown>) => void
          onPending?: (result: Record<string, unknown>) => void
          onError?: (result: Record<string, unknown>) => void
          onClose?: () => void
        },
      ) => void
    }
  }
}

function useSnapScript() {
  const [ready, setReady] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current || !MIDTRANS_CLIENT_KEY) return
    loaded.current = true

    // Check if snap.js is already loaded
    if (window.snap) {
      setReady(true)
      return
    }

    const existing = document.querySelector(`script[src="${MIDTRANS_SNAP_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => setReady(true))
      return
    }

    const script = document.createElement('script')
    script.src = MIDTRANS_SNAP_URL
    script.setAttribute('data-client-key', MIDTRANS_CLIENT_KEY)
    script.async = true
    script.onload = () => setReady(true)
    script.onerror = () => {
      loaded.current = false
    }
    document.head.appendChild(script)
  }, [])

  return ready
}

function CheckoutPage() {
  const { t } = useTranslation('payment')
  const { projectId } = Route.useParams()
  const { type: checkoutType } = Route.useSearch()
  const navigate = useNavigate()
  const snapReady = useSnapScript()
  const createSnapToken = useCreateSnapToken()

  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [checkoutState, setCheckoutState] = useState<CheckoutState>('form')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data: project, isLoading: projectLoading, isError: projectError } = useProject(projectId)
  const { user: authUser } = useAuthStore()

  if (projectLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-surface p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm text-on-surface-muted">
            {t('loading_project', 'Memuat data proyek...')}
          </p>
        </div>
      </div>
    )
  }

  if (projectError || !project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-surface p-6">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error-500/20">
            <AlertCircle className="h-8 w-8 text-error-600" />
          </div>
          <h2 className="text-xl font-semibold text-error-600">
            {t('project_load_error', 'Gagal memuat proyek')}
          </h2>
          <p className="mt-2 text-sm text-on-surface-muted">
            {t('project_load_error_desc', 'Tidak dapat memuat data proyek. Silakan coba lagi.')}
          </p>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('back_to_project', 'Kembali ke Proyek')}
          </Link>
        </div>
      </div>
    )
  }

  // Determine payment amount based on checkout type
  const paymentAmount =
    checkoutType === 'brd'
      ? 99_000
      : checkoutType === 'prd'
        ? 199_000
        : (project.finalPrice ?? project.budgetMax) || 0

  const paymentType =
    checkoutType === 'brd' ? 'brd_payment' : checkoutType === 'prd' ? 'prd_payment' : 'escrow_in'

  const paymentLabel =
    paymentType === 'brd_payment'
      ? t('brd_payment', 'Pembayaran BRD')
      : paymentType === 'prd_payment'
        ? t('prd_payment', 'Pembayaran PRD')
        : t('escrow_in', 'Escrow Deposit')

  function formatRp(n: number) {
    return `Rp ${n.toLocaleString('id-ID')}`
  }

  const handlePay = useCallback(async () => {
    if (!agreedToTerms || !snapReady) return

    setCheckoutState('loading')
    setErrorMessage(null)

    const orderPrefix = checkoutType === 'brd' ? 'BRD' : checkoutType === 'prd' ? 'PRD' : 'ESC'
    const random = Math.random().toString(36).slice(2, 8)
    const orderId = `${orderPrefix}-${projectId.slice(0, 8)}-${Date.now()}-${random}`

    try {
      const result = await createSnapToken.mutateAsync({
        projectId,
        orderId,
        amount: paymentAmount,
        itemName: project.title,
        customerName: authUser?.name ?? '',
        customerEmail: authUser?.email ?? '',
      })

      if (!window.snap) {
        setErrorMessage(
          t('snap_not_loaded', 'Payment gateway belum siap. Silakan muat ulang halaman.'),
        )
        setCheckoutState('error')
        return
      }

      window.snap.pay(result.token, {
        onSuccess: () => {
          setCheckoutState('success')
        },
        onPending: () => {
          setCheckoutState('pending')
        },
        onError: () => {
          setErrorMessage(t('payment_failed', 'Pembayaran gagal. Silakan coba lagi.'))
          setCheckoutState('error')
        },
        onClose: () => {
          // User closed the popup without completing
          if (checkoutState === 'loading') {
            setCheckoutState('form')
          }
        },
      })
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('payment_failed', 'Pembayaran gagal. Silakan coba lagi.')
      setErrorMessage(msg)
      setCheckoutState('error')
    }
  }, [
    agreedToTerms,
    snapReady,
    projectId,
    paymentAmount,
    project.title,
    authUser?.name,
    authUser?.email,
    createSnapToken,
    t,
    checkoutState,
    checkoutType,
  ])

  // Success state
  if (checkoutState === 'success') {
    return (
      <div className="flex items-center justify-center bg-surface p-6">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-500/10">
            <CheckCircle2 className="h-8 w-8 text-primary-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary-600">
            {t('payment_success', 'Pembayaran Berhasil')}
          </h2>
          <p className="mt-2 text-sm text-on-surface-muted">
            {t('payment_success_desc', 'Dana escrow telah diterima. Proyek akan segera dimulai.')}
          </p>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('back_to_project', 'Kembali ke Proyek')}
          </Link>
        </div>
      </div>
    )
  }

  // Pending state
  if (checkoutState === 'pending') {
    return (
      <div className="bg-surface p-6 lg:p-8">
        <div className="mx-auto max-w-lg">
          <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning-500/20">
              <Clock className="h-8 w-8 text-primary-600" />
            </div>
            <h2 className="text-xl font-semibold text-primary-600">
              {t('waiting_payment', 'Menunggu Pembayaran')}
            </h2>
            <p className="mt-2 text-sm text-on-surface-muted">
              {t(
                'pending_payment_desc',
                'Pembayaran Anda sedang diproses. Anda akan menerima notifikasi setelah pembayaran dikonfirmasi.',
              )}
            </p>

            <div className="mt-6 rounded-lg border border-outline-dim/20 bg-surface-container p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs text-on-surface-muted">{t('amount', 'Jumlah')}</span>
                <span className="text-lg font-bold text-primary-600">
                  {formatRp(paymentAmount)}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate({ to: '/projects/$projectId', params: { projectId } })}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                {t('back_to_project', 'Kembali ke Proyek')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (checkoutState === 'error') {
    return (
      <div className="flex items-center justify-center bg-surface p-6">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error-500/20">
            <AlertCircle className="h-8 w-8 text-error-600" />
          </div>
          <h2 className="text-xl font-semibold text-error-600">
            {t('payment_failed', 'Pembayaran Gagal')}
          </h2>
          {errorMessage && <p className="mt-2 text-sm text-on-surface-muted">{errorMessage}</p>}
          <button
            type="button"
            onClick={() => {
              setCheckoutState('form')
              setErrorMessage(null)
            }}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('try_again', 'Coba Lagi')}
          </button>
        </div>
      </div>
    )
  }

  // Main form
  const canPay = agreedToTerms && snapReady && checkoutState !== 'loading'

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.title}
        </Link>

        <h1 className="mb-6 text-2xl font-semibold text-primary-600">
          {t('checkout', 'Checkout')}
        </h1>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Payment info and action */}
          <div className="space-y-6 lg:col-span-3">
            {/* Midtrans info card */}
            <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary-600">
                <ShieldCheck className="h-5 w-5 text-on-surface-muted" />
                {t('payment_method', 'Metode Pembayaran')}
              </h2>
              <p className="text-sm text-on-surface-muted">
                {t(
                  'midtrans_payment_info',
                  'Anda akan diarahkan ke halaman pembayaran Midtrans untuk memilih metode pembayaran (Transfer Bank, QRIS, E-Wallet, dll).',
                )}
              </p>

              {!MIDTRANS_CLIENT_KEY && (
                <div className="mt-3 rounded-lg border border-error-500/30 bg-error-500/10 p-3">
                  <p className="text-xs text-error-600">
                    {t(
                      'midtrans_key_missing',
                      'Konfigurasi payment gateway belum lengkap. Hubungi administrator.',
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Terms and pay button */}
            <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-outline-dim/20 bg-surface-container text-primary-600 focus:ring-primary-500/30"
                />
                <span className="text-sm text-on-surface-muted">
                  {t(
                    'agree_terms',
                    'Saya menyetujui syarat dan ketentuan KerjaCUS! serta kebijakan escrow',
                  )}
                </span>
              </label>

              <button
                type="button"
                onClick={handlePay}
                disabled={!canPay}
                className={cn(
                  'mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3.5 text-sm font-bold transition-colors',
                  !canPay
                    ? 'cursor-not-allowed bg-surface-container text-on-surface-muted'
                    : 'bg-primary-600 text-white shadow-lg hover:opacity-90',
                )}
              >
                {checkoutState === 'loading' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('processing', 'Memproses...')}
                  </>
                ) : (
                  <>
                    <Wallet className="h-4 w-4" />
                    {t('pay_now', 'Bayar Sekarang')} - {formatRp(paymentAmount)}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Order summary */}
          <div className="lg:col-span-2">
            <div className="sticky top-8 rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
              <h2 className="mb-4 text-base font-semibold text-primary-600">
                {t('order_summary', 'Ringkasan Pesanan')}
              </h2>

              <div className="space-y-3">
                <div className="rounded-lg bg-surface-container p-3">
                  <p className="text-sm font-medium text-on-surface">{project.title}</p>
                  <p className="mt-1 text-xs text-on-surface-muted">{paymentLabel}</p>
                </div>

                <div className="border-t border-outline-dim/20 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-on-surface-muted">
                      {t('subtotal', 'Subtotal')}
                    </span>
                    <span className="text-sm font-medium text-on-surface-muted">
                      {formatRp(paymentAmount)}
                    </span>
                  </div>
                </div>

                <div className="border-t border-outline-dim/20 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary-600">
                      {t('total', 'Total')}
                    </span>
                    <span className="text-lg font-bold text-primary-600">
                      {formatRp(paymentAmount)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-primary-500/10 p-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <p className="text-xs text-primary-600">
                  {t(
                    'escrow_description',
                    'Dana Anda dilindungi oleh escrow KerjaCUS!. Pencairan hanya dilakukan setelah milestone di-approve.',
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
