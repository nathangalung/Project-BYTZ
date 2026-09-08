import { createFileRoute, Link } from '@tanstack/react-router'
import { KeyRound, Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '@/lib/api'

export const Route = createFileRoute('/_public/forgot-password')({
  component: ForgotPasswordPage,
})

/**
 * Request a reset link.
 *
 * The reply is the same whether or not the address has an account. Telling a
 * caller that an email is unknown turns this form into an account-existence
 * oracle, which is why every large provider answers identically here.
 *
 * The settings page asks for the current password because that flow proves who
 * you are with the password itself. Someone who has forgotten it cannot, so
 * this flow proves it with a mailbox instead, and asking for both would make
 * the remedy require the thing it exists to replace.
 */
function ForgotPasswordPage() {
  const { t } = useTranslation('auth')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await apiFetch('/api/v1/auth/forget-password', {
        method: 'POST',
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      })
    } catch {
      // Deliberately swallowed. A failure here is either an unknown address or
      // a mail outage, and distinguishing them for the caller is the leak.
    } finally {
      setLoading(false)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-10 shadow-xl">
            <div className="flex flex-col items-center gap-5">
              <div className="rounded-full bg-success-500/10 p-4">
                <Mail className="h-8 w-8 text-success-600" />
              </div>
              <h2 className="text-xl font-semibold text-brand-text">{t('reset_sent_title')}</h2>
              <p className="text-sm leading-relaxed text-on-surface-muted">
                {t('reset_sent_description')}
              </p>
              <p className="text-xs text-on-surface-muted">{t('check_email_spam')}</p>
            </div>
          </div>
          <p className="mt-6 text-sm text-on-surface-muted">
            <Link
              to="/login"
              className="font-medium text-brand-text transition-colors hover:text-brand-accent"
            >
              {t('back_to_login')}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mesh-bg flex min-h-[80vh] items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in">
        <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-8 shadow-xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-full bg-brand-accent/10 p-2.5">
              <KeyRound className="h-5 w-5 text-brand-text" />
            </div>
            <h2 className="text-2xl font-extrabold text-brand-text">{t('forgot_title')}</h2>
          </div>
          <p className="mb-7 text-sm text-on-surface-muted">{t('forgot_subtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('email_label')}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-subtle transition-all focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                placeholder={t('email_placeholder')}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-50"
            >
              {loading ? '...' : t('forgot_button')}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-on-surface-muted">
            <Link
              to="/login"
              className="font-medium text-brand-text transition-colors hover:text-brand-accent"
            >
              {t('back_to_login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
