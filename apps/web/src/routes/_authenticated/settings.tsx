import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Bell,
  Camera,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Save,
  Trash2,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation('common')

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">{t('settings', 'Pengaturan')}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('settings_subtitle', 'Kelola profil dan preferensi akun Anda')}
        </p>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        <ProfileSection />
        <LanguageSection />
        <NotificationPreferencesSection />
        <PasswordSection />
        <DangerZoneSection />
      </div>
    </div>
  )
}

function SectionCard({
  icon,
  title,
  children,
  variant,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  variant?: 'default' | 'danger'
}) {
  return (
    <div
      className={cn(
        'rounded-xl border',
        variant === 'danger'
          ? 'border-error-500/30 bg-neutral-600'
          : 'border-neutral-600/30 bg-neutral-600',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-6 py-4',
          variant === 'danger' ? 'border-error-500/30' : 'border-primary-700/60',
        )}
      >
        {icon}
        <h2
          className={cn(
            'text-base font-semibold',
            variant === 'danger' ? 'text-error-500' : 'text-warning-500',
          )}
        >
          {title}
        </h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function ProfileSection() {
  const { t } = useTranslation('common')
  const [name, setName] = useState('Ahmad Budiman')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function handleSaveProfile() {
    setSaving(true)
    setSaved(false)
    setTimeout(() => {
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }, 800)
  }

  return (
    <SectionCard
      icon={<User className="h-5 w-5 text-success-500" />}
      title={t('profile', 'Profil')}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-700 text-xl font-bold text-warning-500">
              AB
            </div>
            <button
              type="button"
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-neutral-600 bg-success-500 text-primary-800 transition-colors hover:bg-success-500/90"
              title={t('change_avatar', 'Ganti foto')}
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-200">Ahmad Budiman</p>
            <p className="text-xs text-neutral-500">ahmad.budiman@example.com</p>
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-name"
            className="mb-1 block text-sm font-medium text-neutral-400"
          >
            {t('name', 'Nama')}
          </label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>

        <div>
          <label
            htmlFor="settings-email"
            className="mb-1 block text-sm font-medium text-neutral-400"
          >
            {t('email', 'Email')}
          </label>
          <input
            id="settings-email"
            type="email"
            value="ahmad.budiman@example.com"
            disabled
            className="w-full rounded-lg border border-neutral-600/20 bg-primary-800 px-3 py-2.5 text-sm text-neutral-500"
          />
        </div>

        <div>
          <label
            htmlFor="settings-phone"
            className="mb-1 block text-sm font-medium text-neutral-400"
          >
            {t('phone', 'Nomor Telepon')}
          </label>
          <div className="flex gap-2">
            <input
              id="settings-phone"
              type="tel"
              value="+6281234567890"
              disabled
              className="flex-1 rounded-lg border border-neutral-600/20 bg-primary-800 px-3 py-2.5 text-sm text-neutral-500"
            />
            <button
              type="button"
              className="rounded-lg border border-neutral-600/50 px-3 py-2.5 text-sm font-medium text-neutral-400 transition-colors hover:bg-primary-700"
            >
              {t('change', 'Ubah')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-sm text-success-500">{t('saved', 'Tersimpan')}</span>}
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-success-500 px-4 py-2 text-sm font-bold text-primary-800 transition-colors hover:bg-success-500/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? t('loading', 'Memuat...') : t('save', 'Simpan')}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

function LanguageSection() {
  const { t, i18n } = useTranslation('common')
  const [locale, setLocale] = useState(i18n.language ?? 'id')

  function handleLanguageChange(lng: string) {
    setLocale(lng)
    i18n.changeLanguage(lng)
  }

  return (
    <SectionCard
      icon={<Globe className="h-5 w-5 text-warning-500" />}
      title={t('language', 'Bahasa')}
    >
      <div>
        <label
          htmlFor="settings-language"
          className="mb-1 block text-sm font-medium text-neutral-400"
        >
          {t('language_preference', 'Preferensi Bahasa')}
        </label>
        <select
          id="settings-language"
          value={locale}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
        >
          <option value="id">{t('indonesian', 'Bahasa Indonesia')}</option>
          <option value="en">{t('english', 'English')}</option>
        </select>
      </div>
    </SectionCard>
  )
}

function NotificationPreferencesSection() {
  const { t } = useTranslation('common')
  const [emailNotif, setEmailNotif] = useState(true)
  const [projectUpdates, setProjectUpdates] = useState(true)
  const [paymentAlerts, setPaymentAlerts] = useState(true)

  const toggles = [
    {
      id: 'email-notifications',
      label: t('email_notifications', 'Notifikasi Email'),
      description: t('email_notifications_desc', 'Terima pembaruan penting melalui email'),
      checked: emailNotif,
      onChange: setEmailNotif,
    },
    {
      id: 'project-updates',
      label: t('project_updates', 'Pembaruan Proyek'),
      description: t('project_updates_desc', 'Notifikasi saat ada perubahan status proyek'),
      checked: projectUpdates,
      onChange: setProjectUpdates,
    },
    {
      id: 'payment-alerts',
      label: t('payment_alerts', 'Pemberitahuan Pembayaran'),
      description: t('payment_alerts_desc', 'Notifikasi saat ada transaksi atau pencairan dana'),
      checked: paymentAlerts,
      onChange: setPaymentAlerts,
    },
  ]

  return (
    <SectionCard
      icon={<Bell className="h-5 w-5 text-warning-500" />}
      title={t('notification_preferences', 'Preferensi Notifikasi')}
    >
      <div className="space-y-4">
        {toggles.map((toggle) => (
          <div key={toggle.id} className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor={toggle.id} className="text-sm font-medium text-neutral-300">
                {toggle.label}
              </label>
              <p className="text-xs text-neutral-500">{toggle.description}</p>
            </div>
            <button
              id={toggle.id}
              type="button"
              role="switch"
              aria-checked={toggle.checked}
              onClick={() => toggle.onChange(!toggle.checked)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                toggle.checked ? 'bg-success-500' : 'bg-neutral-600',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                  toggle.checked ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function PasswordSection() {
  const { t } = useTranslation('common')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  function handleChangePassword() {
    setError('')
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setError(t('password_mismatch', 'Password baru tidak cocok'))
      return
    }
    if (newPassword.length < 8) {
      setError(t('password_min_length', 'Password minimal 8 karakter'))
      return
    }

    setSuccess(true)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setTimeout(() => setSuccess(false), 3000)
  }

  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length > 0

  return (
    <SectionCard
      icon={<Lock className="h-5 w-5 text-neutral-400" />}
      title={t('change_password', 'Ubah Password')}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-error-500/15 p-3 text-sm text-error-500">{error}</div>
        )}
        {success && (
          <div className="rounded-lg bg-success-500/15 p-3 text-sm text-success-500">
            {t('password_changed', 'Password berhasil diubah')}
          </div>
        )}

        <div>
          <label
            htmlFor="current-password"
            className="mb-1 block text-sm font-medium text-neutral-400"
          >
            {t('current_password', 'Password Saat Ini')}
          </label>
          <div className="relative">
            <input
              id="current-password"
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2.5 pr-10 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-400"
              aria-label={
                showCurrent
                  ? t('hide_password', 'Sembunyikan password')
                  : t('show_password', 'Tampilkan password')
              }
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-neutral-400">
            {t('new_password', 'Password Baru')}
          </label>
          <div className="relative">
            <input
              id="new-password"
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2.5 pr-10 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-400"
              aria-label={
                showNew
                  ? t('hide_password', 'Sembunyikan password')
                  : t('show_password', 'Tampilkan password')
              }
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            {t('password_hint', 'Minimal 8 karakter')}
          </p>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1 block text-sm font-medium text-neutral-400"
          >
            {t('confirm_password', 'Konfirmasi Password Baru')}
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-success-500 px-4 py-2 text-sm font-bold text-primary-800 transition-colors hover:bg-success-500/90 disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {t('change_password', 'Ubah Password')}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

function DangerZoneSection() {
  const { t } = useTranslation('common')
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  return (
    <SectionCard
      icon={<AlertTriangle className="h-5 w-5 text-error-500" />}
      title={t('danger_zone', 'Zona Berbahaya')}
      variant="danger"
    >
      <div>
        <p className="text-sm text-neutral-500">
          {t(
            'delete_account_warning',
            'Menghapus akun akan menghapus semua data Anda secara permanen. Tindakan ini tidak bisa dibatalkan.',
          )}
        </p>

        {!showConfirm ? (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-error-500/30 px-4 py-2 text-sm font-medium text-error-500 transition-colors hover:bg-error-500/10"
          >
            <Trash2 className="h-4 w-4" />
            {t('delete_account', 'Hapus Akun')}
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-error-500/30 bg-error-500/10 p-4">
            <p className="mb-3 text-sm font-medium text-error-500">
              {t('delete_confirm_prompt', 'Ketik "HAPUS" untuk mengonfirmasi penghapusan akun')}
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="HAPUS"
              className="w-full rounded-lg border border-error-500/30 bg-primary-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-error-500/50 focus:outline-none focus:ring-1 focus:ring-error-500/50"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false)
                  setConfirmText('')
                }}
                className="rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-primary-700"
              >
                {t('cancel', 'Batal')}
              </button>
              <button
                type="button"
                disabled={confirmText !== 'HAPUS'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-error-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-error-500/90 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {t('confirm_delete', 'Konfirmasi Hapus')}
              </button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
