import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Briefcase, Eye, EyeOff, Phone, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_public/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneDigits, setPhoneDigits] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<'client' | 'worker'>('client')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validatePhone = (digits: string): boolean => {
    return digits.length >= 9 && digits.length <= 13 && /^\d+$/.test(digits)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (!validatePhone(phoneDigits)) {
      setError(
        t('phone_invalid', 'Format nomor tidak valid. Gunakan format +62 diikuti 9-13 digit'),
      )
      setLoading(false)
      return
    }

    const phone = `+62${phoneDigits}`

    try {
      const res = await fetch('/api/v1/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password, phone, role }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.message || t('register_error', 'Gagal mendaftar'))
        return
      }
      const data = await res.json()
      setUser(data.user)
      useToastStore.getState().addToast('success', 'Akun berhasil dibuat!')

      if (data.user.role === 'worker') {
        navigate({ to: '/worker/register' })
      } else {
        navigate({ to: '/dashboard' })
      }
    } catch {
      setError(t('register_error', 'Gagal mendaftar. Coba lagi.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-600 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-3xl font-bold tracking-tight text-warning-500">
            BYTZ
          </Link>
          <h1 className="mt-4 text-2xl font-semibold text-warning-500">
            {t('register_title', 'Buat akun baru')}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {t('register_subtitle', 'Bergabung dengan ekosistem BYTZ')}
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
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-warning-500">
                {t('name_label', 'Nama Lengkap')}
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="reg-email"
                className="mb-1.5 block text-sm font-medium text-warning-500"
              >
                {t('email_label', 'Email')}
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20"
                placeholder="nama@email.com"
              />
            </div>

            <div>
              <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-warning-500">
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {t('phone_label', 'Nomor Telepon')}
                </span>
              </label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-white/10 bg-neutral-900 px-3 text-sm text-neutral-400">
                  +62
                </span>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={phoneDigits}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 13)
                    setPhoneDigits(digits)
                  }}
                  placeholder="8123456789"
                  className="w-full rounded-r-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20"
                />
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                {t('phone_hint', 'Contoh: +628123456789')}
              </p>
            </div>

            <div>
              <label
                htmlFor="reg-password"
                className="mb-1.5 block text-sm font-medium text-warning-500"
              >
                {t('password_label', 'Password')}
              </label>
              <div className="relative">
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
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

            <div>
              <span className="mb-2 block text-sm font-medium text-warning-500">
                {t('role_label', 'Daftar sebagai')}
              </span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole('client')}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    role === 'client'
                      ? 'border-success-500 bg-success-500/10 text-success-500 shadow-sm shadow-success-500/10'
                      : 'border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-300'
                  }`}
                >
                  <Briefcase className="h-4 w-4" />
                  {t('role_client', 'Client')}
                </button>
                <button
                  type="button"
                  onClick={() => setRole('worker')}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    role === 'worker'
                      ? 'border-error-500 bg-error-500/10 text-error-500 shadow-sm shadow-error-500/10'
                      : 'border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-300'
                  }`}
                >
                  <Wrench className="h-4 w-4" />
                  {t('role_worker', 'Worker')}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-success-500 px-4 py-2.5 text-sm font-semibold text-primary-600 transition-colors hover:bg-success-600 disabled:opacity-50"
            >
              {loading ? '...' : t('register_button', 'Daftar')}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-neutral-500">
          {t('already_have_account', 'Sudah punya akun?')}{' '}
          <Link
            to="/login"
            className="font-medium text-success-500 transition-colors hover:text-success-600"
          >
            {t('login', 'Masuk')}
          </Link>
        </p>
      </div>
    </div>
  )
}
