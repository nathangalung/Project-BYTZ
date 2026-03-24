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
  const [role, setRole] = useState<'owner' | 'talent'>('owner')
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

      if (data.user.role === 'talent') {
        navigate({ to: '/talent/register' })
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
    <div className="mesh-bg flex min-h-[80vh] items-center justify-center p-6 py-12">
      <div className="w-full max-w-md animate-fade-in">
        {/* Tab bar */}
        <div className="mb-7 flex gap-1 rounded-2xl bg-surface-container p-1">
          <Link
            to="/login"
            className="flex-1 rounded-xl py-2.5 text-center text-sm font-bold text-on-surface-muted transition-all hover:text-primary-600"
          >
            {t('login', 'Masuk')}
          </Link>
          <div className="flex-1 rounded-xl bg-surface-bright py-2.5 text-center text-sm font-bold text-primary-600 shadow-sm">
            {t('register', 'Daftar')}
          </div>
        </div>

        {/* Register card */}
        <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-8 shadow-xl">
          <h2 className="text-2xl font-extrabold text-primary-600">
            {t('register_title', 'Buat Akun KerjaCUS!')}
          </h2>
          <p className="mb-6 mt-1 text-sm text-on-surface-muted">
            {t('register_subtitle', 'Daftar sebagai klien atau talenta')}
          </p>

          {error && (
            <div className="mb-4 rounded-xl border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('name_label', 'Nama Lengkap')}
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('name_placeholder', 'Nama Anda')}
                className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              />
            </div>

            <div>
              <label
                htmlFor="reg-email"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                {t('email_label', 'Email')}
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-muted"
              >
                <Phone className="h-3.5 w-3.5" />
                {t('phone_label', 'Nomor Telepon')}
              </label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-outline-dim/30 bg-surface-dim px-3 text-sm text-on-surface-muted">
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
                  className="w-full rounded-r-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                />
              </div>
              <p className="mt-1.5 text-xs text-on-surface-muted">
                {t('phone_hint', 'Contoh: +628123456789')}
              </p>
            </div>

            <div>
              <label
                htmlFor="reg-password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
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
                  placeholder="Min 8 karakter"
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

            <div>
              <p className="mb-3 text-center text-xs font-medium text-on-surface-muted">
                {t('role_label', 'Daftar sebagai:')}
              </p>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setRole('owner')}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all active:scale-95 ${
                    role === 'owner'
                      ? 'bg-primary-600 text-white shadow-lg'
                      : 'border border-outline-dim/20 bg-surface-container text-primary-600 hover:bg-surface-high'
                  }`}
                >
                  <Briefcase className="h-4 w-4" />
                  {t('role_client', 'Owner / Pemberi Proyek')}
                </button>
                <button
                  type="button"
                  onClick={() => setRole('talent')}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all active:scale-95 ${
                    role === 'talent'
                      ? 'bg-primary-600 text-white shadow-lg'
                      : 'border border-outline-dim/20 bg-surface-container text-primary-600 hover:bg-surface-high'
                  }`}
                >
                  <Wrench className="h-4 w-4" />
                  {t('role_worker', 'Talenta / Talent')}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary-600 py-3.5 text-sm font-bold text-white transition-all hover:opacity-90 hover:shadow-lg active:scale-95 disabled:opacity-50"
            >
              {loading ? '...' : t('register_button', 'Daftar')}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-on-surface-muted">
            {t('agree_terms', 'Dengan mendaftar, Anda setuju dengan')}{' '}
            <a href="#" className="text-accent-coral-600 hover:underline">
              {t('terms', 'Syarat & Ketentuan')}
            </a>
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-on-surface-muted">
          {t('already_have_account', 'Sudah punya akun?')}{' '}
          <Link
            to="/login"
            className="font-semibold text-accent-coral-600 transition-colors hover:underline"
          >
            {t('login', 'Masuk')}
          </Link>
        </p>
      </div>
    </div>
  )
}
