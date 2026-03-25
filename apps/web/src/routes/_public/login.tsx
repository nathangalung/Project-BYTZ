import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_public/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(apiUrl('/api/v1/auth/sign-in/email-or-phone'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.message || t('invalid_credentials'))
        return
      }
      const data = await res.json()

      if (data.user.role === 'admin') {
        setError(t('admin_redirect'))
        return
      }

      setUser(data.user)

      if (data.user.role === 'talent') {
        navigate({ to: '/talent' })
      } else {
        navigate({ to: '/dashboard' })
      }
    } catch {
      setError(t('login_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mesh-bg flex min-h-[80vh] items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in">
        {/* Tab bar */}
        <div className="mb-7 flex gap-1 rounded-2xl bg-surface-container p-1">
          <div className="flex-1 rounded-xl bg-surface-bright py-2.5 text-center text-sm font-bold text-primary-600 shadow-sm">
            {t('login')}
          </div>
          <Link
            to="/register"
            className="flex-1 rounded-xl py-2.5 text-center text-sm font-bold text-on-surface-muted transition-all hover:text-primary-600"
          >
            {t('register')}
          </Link>
        </div>

        {/* Login card */}
        <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-8 shadow-xl">
          <h2 className="text-2xl font-extrabold text-primary-600">{t('login_title')}</h2>
          <p className="mb-7 mt-1 text-sm text-on-surface-muted">{t('login_subtitle')}</p>

          {error && (
            <div className="mb-4 rounded-xl border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="identifier"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('email_or_phone_label')}
              </label>
              <input
                id="identifier"
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                placeholder="nama@email.com atau +628123456789"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('password_label')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 pr-10 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-outline hover:text-on-surface-muted"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-bold text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-50"
            >
              {loading ? '...' : t('login_button')}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-outline-dim/30" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-surface-bright px-3 text-on-surface-muted">{t('or')}</span>
            </div>
          </div>

          <a
            href="/api/v1/auth/sign-in/social?provider=google"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm font-semibold text-on-surface transition-all hover:bg-surface-high"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <title>Google</title>
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {t('google_login')}
          </a>
        </div>

        <p className="mt-6 text-center text-sm text-on-surface-muted">
          {t('dont_have_account')}{' '}
          <Link
            to="/register"
            className="font-semibold text-accent-coral-600 transition-colors hover:underline"
          >
            {t('register')}
          </Link>
        </p>
      </div>
    </div>
  )
}
