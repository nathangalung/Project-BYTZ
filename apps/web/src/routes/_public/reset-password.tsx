import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '@/lib/api'

export const Route = createFileRoute('/_public/reset-password')({
  // The token arrives in the link, so it is search state, not a form field.
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: ResetPasswordPage,
})

const MIN_PASSWORD_LENGTH = 8

/**
 * Set a new password from a mailed link.
 *
 * No current password is asked for, and that is the point of the flow: the
 * mailed token is the proof of identity. Requiring the old password here would
 * make the recovery path depend on the thing that was lost.
 */
function ResetPasswordPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { token } = Route.useSearch()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('password_too_short'))
      return
    }
    if (password !== confirm) {
      setError(t('password_mismatch'))
      return
    }
    setLoading(true)
    try {
      await apiFetch('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: password, token }),
      })
      navigate({ to: '/login' })
    } catch {
      // A spent or expired token is the common case, and it is recoverable by
      // asking for a new link rather than by retrying this form.
      setError(t('reset_token_invalid'))
    } finally {
      setLoading(false)
    }
  }

  // A link that carried no token cannot be completed, so the page offers the
  // way back instead of a form that is guaranteed to fail on submit.
  if (!token) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-10 shadow-xl">
            <h2 className="text-xl font-semibold text-brand-text">{t('reset_token_missing')}</h2>
            <p className="mt-3 text-sm text-on-surface-muted">{t('reset_token_invalid')}</p>
            <Link
              to="/forgot-password"
              className="mt-6 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
            >
              {t('forgot_button')}
            </Link>
          </div>
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
              <ShieldCheck className="h-5 w-5 text-brand-text" />
            </div>
            <h2 className="text-2xl font-extrabold text-brand-text">{t('reset_title')}</h2>
          </div>
          <p className="mb-7 text-sm text-on-surface-muted">{t('reset_subtitle')}</p>

          {error && (
            <div className="mb-4 rounded-xl border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('new_password_label')}
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 pr-10 text-sm text-on-surface transition-all focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-outline hover:text-on-surface-muted"
                  aria-label={showPassword ? t('hide_password') : t('show_password')}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-on-surface-muted">{t('password_hint')}</p>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('confirm_password_label')}
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface transition-all focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-50"
            >
              {loading ? '...' : t('reset_button')}
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
