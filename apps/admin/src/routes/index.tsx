import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff, Shield } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/')({
  component: AdminLoginPage,
})

function AdminLoginPage() {
  const { t } = useTranslation('admin')
  const navigate = useNavigate()
  const { setUser, isAuthenticated } = useAuthStore()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // If already authenticated as admin, redirect to dashboard
  if (isAuthenticated) {
    navigate({ to: '/dashboard' })
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/sign-in/email-or-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.message ?? t('invalid_credentials'))
        return
      }
      const data = await res.json()

      // Only allow admin role
      if (data.user.role !== 'admin') {
        setError(t('not_admin'))
        return
      }

      setUser({
        ...data.user,
        role: 'admin' as const,
      })
      navigate({ to: '/dashboard' })
    } catch {
      setError(t('login_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-700 ring-2 ring-warning-500/30">
            <Shield className="h-8 w-8 text-warning-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-warning-500">{t('admin_panel')}</h1>
          <p className="mt-2 text-sm text-neutral-300">{t('login_subtitle')}</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-neutral-600/40 p-8 shadow-xl shadow-black/20">
          {error && (
            <div className="mb-4 rounded-lg border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-500">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="identifier"
                className="mb-1.5 block text-sm font-medium text-warning-500"
              >
                {t('email_or_phone_label')}
              </label>
              <input
                id="identifier"
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20"
                placeholder="admin@bytz.id"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-warning-500"
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
                  className="w-full rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 pr-10 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-neutral-300 hover:text-neutral-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-success-500 px-4 py-2.5 text-sm font-semibold text-primary-600 transition-colors hover:bg-success-600 disabled:opacity-50"
            >
              {loading ? '...' : t('login_button')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
