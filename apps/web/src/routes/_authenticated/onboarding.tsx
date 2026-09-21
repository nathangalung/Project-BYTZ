import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Briefcase, Phone, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, apiFetch } from '@/lib/api'
import { type User, useAuthStore } from '@/stores/auth'

/**
 * Where a Google sign-up chooses what it is.
 *
 * Google gives no phone number and OAuth never reaches the sign-up handler, so
 * the account is created on the column default - owner - and a talent who
 * signed in that way had no way back. A missing phone is what marks the
 * account as unfinished, and the authenticated guard sends every such account
 * here before it can reach any other page.
 */
export const Route = createFileRoute('/_authenticated/onboarding')({
  // Someone who already has a phone finished this once, and role does not
  // change twice: the endpoint would refuse anyway.
  beforeLoad: () => {
    const { user } = useAuthStore.getState()
    if (user?.phone) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: OnboardingPage,
})

// Which field is at fault, in copy the generic catalog message cannot give.
// complete-onboarding names the field it refused rather than sharing CONFLICT
// with every other handler that raises one.
const ONBOARDING_ERROR_KEYS: Record<string, string> = {
  AUTH_FORBIDDEN: 'onboarding_already_done',
  AUTH_PHONE_ALREADY_EXISTS: 'phone_already_exists',
  AUTH_INVALID_PHONE: 'phone_invalid',
  AUTH_INVALID_ROLE: 'role_invalid',
}

function OnboardingPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const [role, setRole] = useState<'owner' | 'talent'>('owner')
  const [phoneDigits, setPhoneDigits] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (phoneDigits.length < 9 || phoneDigits.length > 13) {
      setError(t('phone_invalid'))
      setLoading(false)
      return
    }

    try {
      // The reply carries the stored row. Better Auth caches the session for
      // five minutes, so reading the role back from get-session would show the
      // old one for that long.
      const data = await apiFetch<{ data: User }>('/api/v1/auth/complete-onboarding', {
        method: 'POST',
        body: JSON.stringify({ role, phone: `+62${phoneDigits}` }),
      })

      setUser(data.data)

      if (role === 'talent') {
        navigate({ to: '/talent/register' })
      } else {
        navigate({ to: '/dashboard' })
      }
    } catch (err) {
      const key = err instanceof ApiError ? ONBOARDING_ERROR_KEYS[err.code] : undefined
      setError(t(key ?? 'onboarding_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 py-12">
      <div className="w-full max-w-md animate-fade-in">
        <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-8 shadow-xl">
          <h1 className="text-2xl font-extrabold text-brand-text">{t('onboarding_title')}</h1>
          <p className="mb-6 mt-1 text-sm text-on-surface-muted">{t('onboarding_subtitle')}</p>

          {error && (
            <div className="mb-4 rounded-xl border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <p className="mb-3 text-center text-xs font-medium text-on-surface-muted">
                {t('role_label')}
              </p>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setRole('owner')}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all active:scale-95 ${
                    role === 'owner'
                      ? 'bg-brand text-white shadow-lg'
                      : 'border border-outline-dim/20 bg-surface-container text-brand-text hover:bg-surface-high'
                  }`}
                >
                  <Briefcase className="h-4 w-4" />
                  {t('role_owner')}
                </button>
                <button
                  type="button"
                  onClick={() => setRole('talent')}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all active:scale-95 ${
                    role === 'talent'
                      ? 'bg-brand text-white shadow-lg'
                      : 'border border-outline-dim/20 bg-surface-container text-brand-text hover:bg-surface-high'
                  }`}
                >
                  <Wrench className="h-4 w-4" />
                  {t('role_talent')}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="onboarding-phone"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                <Phone className="h-3.5 w-3.5" />
                {t('phone_label')}
              </label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-outline-dim/30 bg-surface-dim px-3 text-sm text-on-surface-muted">
                  +62
                </span>
                <input
                  id="onboarding-phone"
                  type="tel"
                  required
                  value={phoneDigits}
                  onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 13))}
                  placeholder={t('phone_placeholder')}
                  className="w-full rounded-r-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-subtle transition-all focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                />
              </div>
              <p className="mt-1.5 text-xs text-on-surface-muted">{t('phone_hint')}</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-white transition-all hover:opacity-90 hover:shadow-lg active:scale-95 disabled:opacity-50"
            >
              {loading ? '...' : t('onboarding_button')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
