import type { ApiResponse, User } from '@kerjacus/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Bell, Camera, Eye, EyeOff, Lock, Save, User as UserIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackButton } from '@/components/ui/back-button'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
})

type NotifPrefs = {
  emailNotifications: boolean
  projectUpdates: boolean
  paymentAlerts: boolean
}

/**
 * What the route reads back from /api/v1/me.
 *
 * Declared here rather than widening the shared User: preferences live in
 * their own table and only this page and notification-service care.
 */
type MeResponse = User & { notificationPreferences?: NotifPrefs }

// Mirrors updateProfileSchema in apps/auth-service/src/routes/me.ts. A number
// the server refuses has to be refused here too, or the save fails silently.
const PHONE_PATTERN = /^\+62\d{9,13}$/

function SettingsPage() {
  const { t } = useTranslation('common')

  return (
    <div className="bg-surface p-6 lg:p-8">
      {/* Settings is not in the sidebar, so it is always a drill-in from the
          account menu; the dashboard is where that menu lives. */}
      <BackButton to="/dashboard" />

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-brand-text">{t('settings')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">{t('settings_subtitle')}</p>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        <ProfileSection />
        <NotificationPreferencesSection />
        <PasswordSection />
      </div>
    </div>
  )
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <div className="flex items-center gap-2 border-b border-outline-dim/20 px-6 py-4">
        {icon}
        <h2 className="text-base font-semibold text-brand-text">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function ProfileSection() {
  const { t } = useTranslation('common')
  const { user, setUser } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [phoneError, setPhoneError] = useState('')
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateProfile = useMutation({
    mutationFn: async (data: { name: string; phone?: string }) => {
      const res = await apiFetch<ApiResponse<MeResponse>>('/api/v1/me', {
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
    // Without this a rejected save looked exactly like a successful one: no
    // confirmation, no message, the typed value still on screen.
    onError: () => addToast('error', t('profile_save_error')),
  })

  const updateAvatar = useMutation({
    mutationFn: async (file: File) => {
      const presignRes = await apiFetch<{ data: { url: string; contentType: string } }>(
        '/api/v1/upload/presigned-url',
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type,
            folder: 'avatar',
            fileSize: file.size,
          }),
        },
      )
      const { url, contentType } = presignRes.data
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } })
      const publicUrl = url.split('?')[0]
      const res = await apiFetch<ApiResponse<MeResponse>>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: publicUrl }),
      })
      return res.data
    },
    // The stored row is the truth, not the URL this page guessed: the server
    // is free to normalise it, and showing the guess hides that it did.
    onSuccess: (updated) => {
      if (updated) setUser(updated)
    },
    onError: () => addToast('error', t('avatar_upload_error')),
  })

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) updateAvatar.mutate(file)
    e.target.value = ''
  }

  function handleSaveProfile() {
    const trimmedPhone = phone.trim()
    if (trimmedPhone && !PHONE_PATTERN.test(trimmedPhone)) {
      setPhoneError(t('phone_invalid'))
      return
    }
    setPhoneError('')
    updateProfile.mutate({
      name: name.trim() || (user?.name ?? ''),
      // An unchanged number is left out: sending it would clear phoneVerified
      // and send the account back through the OTP flow for nothing.
      ...(trimmedPhone && trimmedPhone !== user?.phone ? { phone: trimmedPhone } : {}),
    })
  }

  return (
    <SectionCard icon={<UserIcon className="h-5 w-5 text-success-600" />} title={t('profile')}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-xl font-bold text-brand-text">
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
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-outline-dim/20 bg-brand text-white transition-colors hover:opacity-90 disabled:opacity-50"
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
            className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+628123456789"
              className="flex-1 rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
            />
          </div>
          {phoneError && <p className="mt-1 text-xs text-error-600">{phoneError}</p>}
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

const PREF_DEFAULTS: NotifPrefs = {
  emailNotifications: true,
  projectUpdates: true,
  paymentAlerts: true,
}

function NotificationPreferencesSection() {
  const { t } = useTranslation('common')
  const addToast = useToastStore((s) => s.addToast)
  const [prefs, setPrefs] = useState<NotifPrefs>(PREF_DEFAULTS)

  // The toggles used to be hard-coded on, so a user who had turned email off
  // saw it on again on every visit. Read the account's own answer first.
  const { data: me } = useQuery({
    queryKey: ['me', 'notification-preferences'],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<MeResponse>>('/api/v1/me')
      return res.data ?? null
    },
  })

  useEffect(() => {
    if (me?.notificationPreferences) setPrefs(me.notificationPreferences)
  }, [me])

  const updatePrefs = useMutation({
    mutationFn: async ({ next }: { next: NotifPrefs; previous: NotifPrefs }) => {
      const res = await apiFetch<ApiResponse<MeResponse>>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ notificationPreferences: next }),
      })
      return res.data ?? null
    },
    onSuccess: (updated) => {
      if (updated?.notificationPreferences) setPrefs(updated.notificationPreferences)
    },
    // The switch flips before the request, so a refused write has to flip it
    // back: a toggle left showing the value the server rejected is a lie.
    onError: (_error, { previous }) => {
      setPrefs(previous)
      addToast('error', t('notification_save_error'))
    },
  })

  function handleToggle(key: keyof NotifPrefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    updatePrefs.mutate({ next, previous: prefs })
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
      icon={<Bell className="h-5 w-5 text-brand-text" />}
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
    changePassword.mutate({ currentPassword, newPassword })
  }

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    confirmPassword.length > 0 &&
    !changePassword.isPending

  return (
    <SectionCard
      icon={<Lock className="h-5 w-5 text-on-surface-muted" />}
      title={t('change_password')}
    >
      <div className="space-y-4">
        {/* onError writes the message here, so this is the only source. */}
        {validationError && (
          <div className="rounded-lg bg-error-500/10 p-3 text-sm text-error-600">
            {validationError}
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
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 pr-10 text-sm text-on-surface focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
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
          {/* The way out for someone who cannot fill the field above. */}
          <Link
            to="/forgot-password"
            className="mt-1.5 inline-block text-xs font-medium text-brand-text hover:underline"
          >
            {t('forgot_current_password')}
          </Link>
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
              className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 pr-10 text-sm text-on-surface focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
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
            className="w-full rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-on-surface focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
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
