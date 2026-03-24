import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_public/verify-email')({
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { t } = useTranslation('auth')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')

    if (error) {
      setStatus('error')
      setMessage(t('email_verify_error', 'Verifikasi gagal. Link mungkin sudah kadaluarsa.'))
    } else {
      setStatus('success')
      setMessage(t('email_verified', 'Email berhasil diverifikasi!'))
    }
  }, [t])

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-10 shadow-sm">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-success-600" />
              <p className="text-on-surface-muted">{t('verifying', 'Memverifikasi...')}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-5">
              <div className="rounded-full bg-success-500/10 p-3">
                <CheckCircle className="h-10 w-10 text-success-600" />
              </div>
              <h2 className="text-xl font-semibold text-primary-600">{message}</h2>
              <p className="text-sm text-on-surface-muted">
                {t('email_verify_next', 'Silakan login untuk melanjutkan.')}
              </p>
              <Link
                to="/login"
                className="mt-2 rounded-lg bg-primary-600 px-8 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
              >
                {t('login', 'Masuk')}
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-5">
              <div className="rounded-full bg-error-500/10 p-3">
                <XCircle className="h-10 w-10 text-error-600" />
              </div>
              <h2 className="text-xl font-semibold text-primary-600">{message}</h2>
              <p className="text-sm text-on-surface-muted">
                {t('email_verify_retry', 'Coba daftar ulang atau hubungi support.')}
              </p>
              <Link
                to="/register"
                className="mt-2 rounded-lg bg-error-600 px-8 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700"
              >
                {t('register', 'Daftar')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
