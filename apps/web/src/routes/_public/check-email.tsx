import { createFileRoute, Link } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_public/check-email')({
  component: CheckEmailPage,
})

function CheckEmailPage() {
  const { t } = useTranslation('auth')

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-10 shadow-sm">
          <div className="flex flex-col items-center gap-5">
            <div className="rounded-full bg-success-500/10 p-4">
              <Mail className="h-8 w-8 text-success-600" />
            </div>
            <h2 className="text-xl font-semibold text-primary-600">{t('check_email_title')}</h2>
            <p className="text-sm leading-relaxed text-on-surface-muted">
              {t('check_email_description')}
            </p>
            <p className="text-xs text-on-surface-muted">{t('check_email_spam')}</p>
          </div>
        </div>

        <p className="mt-6 text-sm text-on-surface-muted">
          <Link
            to="/login"
            className="font-medium text-primary-600 transition-colors hover:text-primary-500"
          >
            {t('back_to_login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
