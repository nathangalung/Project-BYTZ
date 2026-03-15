import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
      // Use email-or-phone endpoint — accepts both email and +62 phone
      const res = await fetch('/api/v1/auth/sign-in/email-or-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.message || t('invalid_credentials', 'Email/nomor HP atau password salah'))
        return
      }
      const data = await res.json()

      // Block admin from main login — must use separate admin panel (port 5174)
      if (data.user.role === 'admin') {
        setError(
          t('admin_redirect', 'Admin harus login melalui admin panel terpisah (admin.bytz.id).'),
        )
        return
      }

      setUser(data.user)

      // Role-based redirect
      if (data.user.role === 'worker') {
        navigate({ to: '/worker' })
      } else {
        navigate({ to: '/dashboard' })
      }
    } catch {
      setError(t('login_error', 'Gagal login. Coba lagi.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-600 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-3xl font-bold tracking-tight text-warning-500">
            BYTZ
          </Link>
          <h1 className="mt-4 text-2xl font-semibold text-warning-500">
            {t('login_title', 'Masuk ke akun')}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {t('login_subtitle', 'Selamat datang kembali di BYTZ')}
          </p>
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
                {t('email_or_phone_label', 'Email atau Nomor HP')}
              </label>
              <input
                id="identifier"
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20"
                placeholder="nama@email.com atau +628123456789"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-warning-500"
              >
                {t('password_label', 'Password')}
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
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
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
              {loading ? '...' : t('login_button', 'Masuk')}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-neutral-600 px-3 text-neutral-500">{t('or', 'atau')}</span>
            </div>
          </div>

          <a
            href="/api/v1/auth/sign-in/social?provider=google"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-white/20 hover:bg-neutral-700"
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
            {t('google_login', 'Masuk dengan Google')}
          </a>
        </div>

        <p className="mt-6 text-center text-sm text-neutral-500">
          {t('dont_have_account', 'Belum punya akun?')}{' '}
          <Link
            to="/register"
            className="font-medium text-success-500 transition-colors hover:text-success-600"
          >
            {t('register', 'Daftar')}
          </Link>
        </p>
      </div>
    </div>
  )
}
