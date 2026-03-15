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
    <div className="flex min-h-screen items-center justify-center bg-primary-600 px-4">
      <div className="w-full max-w-md text-center">
        <Link to="/" className="text-3xl font-bold tracking-tight text-warning-500">
          BYTZ
        </Link>

        <div className="mt-8 rounded-xl border border-white/10 bg-neutral-600/40 p-10 shadow-xl shadow-black/20">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-success-500" />
              <p className="text-neutral-400">{t('verifying', 'Memverifikasi...')}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-5">
              <div className="rounded-full bg-success-500/10 p-3">
                <CheckCircle className="h-10 w-10 text-success-500" />
              </div>
              <h2 className="text-xl font-semibold text-warning-500">{message}</h2>
              <p className="text-sm text-neutral-400">
                {t('email_verify_next', 'Silakan login untuk melanjutkan.')}
              </p>
              <Link
                to="/login"
                className="mt-2 rounded-lg bg-success-500 px-8 py-2.5 text-sm font-semibold text-primary-600 transition-colors hover:bg-success-600"
              >
                {t('login', 'Masuk')}
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-5">
              <div className="rounded-full bg-error-500/10 p-3">
                <XCircle className="h-10 w-10 text-error-500" />
              </div>
              <h2 className="text-xl font-semibold text-warning-500">{message}</h2>
              <p className="text-sm text-neutral-400">
                {t('email_verify_retry', 'Coba daftar ulang atau hubungi support.')}
              </p>
              <Link
                to="/register"
                className="mt-2 rounded-lg bg-error-500 px-8 py-2.5 text-sm font-semibold text-primary-600 transition-colors hover:bg-error-600"
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
