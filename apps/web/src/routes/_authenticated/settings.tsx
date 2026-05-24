import type { ApiResponse, User } from '@kerjacus/shared'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Bell,
  Camera,
  Eye,
  EyeOff,
  Lock,
  Save,
  Trash2,
  User as UserIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation('common')

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary-600">{t('settings')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">{t('settings_subtitle')}</p>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        <ProfileSection />
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
          ? 'border-error-500/30 bg-surface-bright'
          : 'border-outline-dim/20 bg-surface-bright',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-6 py-4',
          variant === 'danger' ? 'border-error-500/30' : 'border-outline-dim/20',
        )}
      >
        {icon}
        <h2
          className={cn(
            'text-base font-semibold',
            variant === 'danger' ? 'text-error-600' : 'text-primary-600',
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
  const { user, setUser } = useAuthStore()
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateProfile = useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiFetch<ApiResponse<User>>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      return res.data
    },
    onSuccess: (updated) => {
      if (updated) setUser(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const updateAvatar = useMutation({
    mutationFn: async (file: File) => {
      const presignRes = await apiFetch<{ data: { url: string } }>('/api/v1/upload/presigned-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileType: file.type, folder: 'avatars' }),
      })
      const { url } = presignRes.data
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      const publicUrl = url.split('?')[0]
      const res = await apiFetch<ApiResponse<User>>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: publicUrl }),
      })
      return res.data
    },
    onSuccess: (updated) => {
      if (updated) setUser(updated)
    },
  })

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) updateAvatar.mutate(file)
    e.target.value = ''
  }

  function handleSaveProfile() {
    updateProfile.mutate({ name: name.trim() || (user?.name ?? '') })
  }

  return (
    <SectionCard icon={<UserIcon className="h-5 w-5 text-success-600" />} title={t('profile')}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-xl font-bold text-primary-600">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name ?? 'avatar'}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                (user?.name?.[0] ?? 'U').toUpperCase()
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={updateAvatar.isPending}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-outline-dim/20 bg-primary-600 text-white transition-colors hover:opacity-90 disabled:opacity-50"
              title={t('change_avatar')}
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          </div>
          <div>
            <p className="text-sm font-medium text-on-surface">{user?.name ?? '-'}</p>
            <p className="text-xs text-on-surface-muted">{user?.email ?? '-'}</p>
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-name"
            className="mb-1 block text-sm font-medium text-on-surface-muted"
          >
            {t('name')}
          </label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </div>

        <div>
          <label
            htmlFor="settings-email"
            className="mb-1 block text-sm font-medium text-on-surface-muted"
          >
            {t('email')}
          </label>
          <input
            id="settings-email"
            type="email"
            value={user?.email ?? ''}
            disabled
            className="w-full rounded-lg border border-outline-dim/20/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface-muted"
          />
        </div>

        <div>
          <label
            htmlFor="settings-phone"
            className="mb-1 block text-sm font-medium text-on-surface-muted"
          >
            {t('phone')}
          </label>
          <div className="flex gap-2">
            <input
              id="settings-phone"
              type="tel"
              value={user?.phone ?? ''}
              disabled
              className="flex-1 rounded-lg border border-outline-dim/20/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface-muted"
            />
            <button
              type="button"
              className="rounded-lg border border-outline-dim/20/50 px-3 py-2.5 text-sm font-medium text-on-surface-muted transition-colors hover:bg-surface-container"
            >
              {t('change')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-sm text-success-600">{t('saved')}</span>}
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={updateProfile.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-success-500 px-4 py-2 text-sm font-bold text-primary-600 transition-colors hover:bg-success-500/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateProfile.isPending ? t('loading') : t('save')}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

type NotifPrefs = { emailNotifications: boolean; projectUpdates: boolean; paymentAlerts: boolean }

function NotificationPreferencesSection() {
  const { t } = useTranslation('common')
  const [prefs, setPrefs] = useState<NotifPrefs>({
    emailNotifications: true,
    projectUpdates: true,
    paymentAlerts: true,
  })

  const updatePrefs = useMutation({
    mutationFn: async (data: NotifPrefs) => {
      await apiFetch<ApiResponse<User>>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ notificationPreferences: data }),
      })
    },
  })

  function handleToggle(key: keyof NotifPrefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    updatePrefs.mutate(next)
  }

  const toggles: { id: string; key: keyof NotifPrefs; label: string; description: string }[] = [
    {
      id: 'email-notifications',
      key: 'emailNotifications',
      label: t('email_notifications'),
      description: t('email_notifications_desc'),
    },
    {
      id: 'project-updates',
      key: 'projectUpdates',
      label: t('project_updates'),
      description: t('project_updates_desc'),
    },
    {
      id: 'payment-alerts',
      key: 'paymentAlerts',
      label: t('payment_alerts'),
      description: t('payment_alerts_desc'),
    },
  ]

  return (
    <SectionCard
      icon={<Bell className="h-5 w-5 text-primary-600" />}
      title={t('notification_preferences')}
    >
      <div className="space-y-4">
        {toggles.map((toggle) => (
          <div key={toggle.id} className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor={toggle.id} className="text-sm font-medium text-on-surface-muted">
                {toggle.label}
              </label>
              <p className="text-xs text-on-surface-muted">{toggle.description}</p>
            </div>
            <button
              id={toggle.id}
              type="button"
              role="switch"
              aria-checked={prefs[toggle.key]}
              onClick={() => handleToggle(toggle.key)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                prefs[toggle.key] ? 'bg-success-500' : 'bg-surface-bright',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-surface-bright transition-transform',
                  prefs[toggle.key] ? 'translate-x-6' : 'translate-x-1',
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
  const [validationError, setValidationError] = useState('')

  const changePassword = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      await apiFetch('/api/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ ...data, revokeOtherSessions: false }),
      })
    },
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setValidationError('')
    },
    onError: () => {
      setValidationError(t('password_change_error'))
    },
  })

  function handleChangePassword() {
    setValidationError('')
    if (newPassword !== confirmPassword) {
      setValidationError(t('password_mismatch'))
      return
    }
    if (newPassword.length < 8) {
      setValidationError(t('password_min_length'))
      return
    }
    changePassword.mutate({ currentPassword, newPassword })
  }

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    confirmPassword.length > 0 &&
    !changePassword.isPending

  const displayError = validationError || (changePassword.isError ? t('password_change_error') : '')

  return (
    <SectionCard
      icon={<Lock className="h-5 w-5 text-on-surface-muted" />}
      title={t('change_password')}
    >
      <div className="space-y-4">
        {displayError && (
          <div className="rounded-lg bg-error-500/10 p-3 text-sm text-error-600">
            {displayError}
          </div>
        )}
        {changePassword.isSuccess && (
          <div className="rounded-lg bg-success-500/10 p-3 text-sm text-success-600">
            {t('password_changed')}
          </div>
        )}

        <div>
          <label
            htmlFor="current-password"
            className="mb-1 block text-sm font-medium text-on-surface-muted"
          >
            {t('current_password')}
          </label>
          <div className="relative">
            <input
              id="current-password"
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 pr-10 text-sm text-on-surface focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-muted hover:text-on-surface-muted"
              aria-label={showCurrent ? t('hide_password') : t('show_password')}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="new-password"
            className="mb-1 block text-sm font-medium text-on-surface-muted"
          >
            {t('new_password')}
          </label>
          <div className="relative">
            <input
              id="new-password"
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 pr-10 text-sm text-on-surface focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-muted hover:text-on-surface-muted"
              aria-label={showNew ? t('hide_password') : t('show_password')}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-on-surface-muted">{t('password_hint')}</p>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1 block text-sm font-medium text-on-surface-muted"
          >
            {t('confirm_password')}
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-success-500 px-4 py-2 text-sm font-bold text-primary-600 transition-colors hover:bg-success-500/90 disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {changePassword.isPending ? t('loading') : t('change_password')}
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
      icon={<AlertTriangle className="h-5 w-5 text-error-600" />}
      title={t('danger_zone')}
      variant="danger"
    >
      <div>
        <p className="text-sm text-on-surface-muted">{t('delete_account_warning')}</p>

        {!showConfirm ? (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-error-500/30 px-4 py-2 text-sm font-medium text-error-600 transition-colors hover:bg-error-500/10"
          >
            <Trash2 className="h-4 w-4" />
            {t('delete_account')}
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-error-500/30 bg-error-500/10 p-4">
            <p className="mb-3 text-sm font-medium text-error-600">{t('delete_confirm_prompt')}</p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="HAPUS"
              className="w-full rounded-lg border border-error-500/30 bg-surface-container px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-muted focus:border-error-500/50 focus:outline-none focus:ring-1 focus:ring-error-500/50"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false)
                  setConfirmText('')
                }}
                className="rounded-lg border border-outline-dim/20/50 px-4 py-2 text-sm font-medium text-on-surface-muted transition-colors hover:bg-surface-container"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={confirmText !== 'HAPUS'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-error-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-error-500/90 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {t('confirm_delete')}
              </button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
