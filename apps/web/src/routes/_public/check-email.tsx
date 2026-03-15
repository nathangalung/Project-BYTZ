import { createFileRoute, Link } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_public/check-email')({
  component: CheckEmailPage,
})

function CheckEmailPage() {
  const { t } = useTranslation('auth')

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-600 px-4">
      <div className="w-full max-w-md text-center">
        <Link to="/" className="text-3xl font-bold tracking-tight text-warning-500">
          BYTZ
        </Link>

        <div className="mt-8 rounded-xl border border-white/10 bg-neutral-600/40 p-10 shadow-xl shadow-black/20">
          <div className="flex flex-col items-center gap-5">
            <div className="rounded-full bg-success-500/10 p-4">
              <Mail className="h-8 w-8 text-success-500" />
            </div>
            <h2 className="text-xl font-semibold text-warning-500">
              {t('check_email_title', 'Cek Email Anda')}
            </h2>
            <p className="text-sm leading-relaxed text-neutral-400">
              {t(
                'check_email_description',
                'Kami telah mengirim link verifikasi ke email Anda. Silakan klik link tersebut untuk mengaktifkan akun.',
              )}
            </p>
            <p className="text-xs text-neutral-500">
              {t('check_email_spam', 'Tidak menerima email? Cek folder spam.')}
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm text-neutral-500">
          <Link
            to="/login"
            className="font-medium text-success-500 transition-colors hover:text-success-600"
          >
            {t('back_to_login', 'Kembali ke halaman login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
