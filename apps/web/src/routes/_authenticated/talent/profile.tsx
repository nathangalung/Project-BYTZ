import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import {
  BadgeCheck,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
  Star,
  Upload,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  EducationSection,
  PortfolioSection,
  ProfileSkeleton,
  RatingHistorySection,
  SkillsSection,
} from '@/components/talent/profile/sections'
import { type TalentProfile, VERIFICATION_COLORS } from '@/components/talent/profile/shared'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import {
  useTalentProfile as useTalentProfileHook,
  useUpdateAvailability,
  useUploadPresignedUrl,
} from '@/hooks/use-talent'
import { apiUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/talent/profile')({
  component: TalentProfilePage,
})

function TalentProfilePage() {
  const { t } = useTranslation('talent')

  return (
    <ErrorBoundary>
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <ProfileContent t={t} />
        </div>
      </div>
    </ErrorBoundary>
  )
}

function ProfileContent({ t }: { t: TFunction }) {
  const { user } = useAuthStore()
  const {
    data: profile,
    isLoading,
    isError,
  } = useTalentProfileHook(user?.id ?? '') as {
    data: TalentProfile | undefined
    isLoading: boolean
    isError: boolean
  }

  if (isLoading) {
    return <ProfileSkeleton />
  }

  if (isError || !profile) {
    return (
      <EmptyState
        icon={<User className="h-12 w-12 text-on-surface-muted" />}
        title={t('profile_not_found')}
        description={t('profile_not_found_description')}
      />
    )
  }

  return (
    <div className="space-y-6">
      <ProfileHeader user={user} profile={profile} t={t} />
      <StatsRow profile={profile} t={t} />
      <SkillsSection profile={profile} t={t} />
      <PortfolioSection profile={profile} t={t} />
      <EducationSection profile={profile} t={t} />
      <RatingHistorySection t={t} />
    </div>
  )
}

function ProfileHeader({
  user,
  profile,
  t,
}: {
  user: { name: string; avatarUrl?: string | null } | null
  profile: TalentProfile
  t: TFunction
}) {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [reparsing, setReparsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const updateAvailability = useUpdateAvailability()
  const uploadPresigned = useUploadPresignedUrl()

  async function handleReparse() {
    setReparsing(true)
    try {
      const res = await fetch(apiUrl('/api/v1/upload/reparse-cv'), {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ['talent-profile'] })
        addToast('success', t('reparse_success'))
        return
      }
      // Storage dropped the file, and the server forgot the key with it, so
      // refetch to swap this button for the upload control.
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
      const missing = body?.error?.code === 'CV_FILE_MISSING'
      if (missing) await queryClient.invalidateQueries({ queryKey: ['talent-profile'] })
      addToast('error', t(missing ? 'reparse_missing' : 'reparse_error'))
    } catch {
      addToast('error', t('reparse_error'))
    } finally {
      setReparsing(false)
    }
  }

  // Replaces a CV storage no longer holds.
  async function handleUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      addToast('error', t('file_too_large'))
      return
    }

    setUploading(true)
    try {
      const presigned = await uploadPresigned.mutateAsync({
        fileName: file.name,
        fileType: file.type,
        folder: 'cv',
      })
      const stored = await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!stored.ok) throw new Error('upload failed')

      const res = await fetch(apiUrl('/api/v1/upload/parse-cv'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          key: presigned.key,
          token: presigned.token,
          fileType: file.name.split('.').pop(),
        }),
      })
      if (!res.ok) throw new Error('parse failed')

      await queryClient.invalidateQueries({ queryKey: ['talent-profile'] })
      addToast('success', t('reparse_success'))
    } catch {
      addToast('error', t('upload_failed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-600/15 text-xl font-semibold text-primary-600">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user?.name ?? ''}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            (user?.name?.[0] ?? 'W').toUpperCase()
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-primary-600">{user?.name}</h1>
            {profile.verificationStatus === 'verified' && (
              <BadgeCheck className="h-5 w-5 text-success-500" />
            )}
          </div>
          {/* Tier is internal-only and never shown, even to the talent. */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                VERIFICATION_COLORS[profile.verificationStatus] ??
                  'bg-surface-container text-on-surface-muted',
              )}
            >
              {t(`verification_${profile.verificationStatus}`, profile.verificationStatus)}
            </span>
            <span className="text-xs text-on-surface-muted">
              {t('years_experience').replace('{{count}}', String(profile.yearsOfExperience))}
            </span>
            {profile.verificationStatus === 'unverified' &&
              (profile.cvFileUrl ? (
                <button
                  type="button"
                  onClick={handleReparse}
                  disabled={reparsing}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {reparsing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t('reparse_cv')}
                </button>
              ) : (
                /* Without a stored CV there is nothing to re-parse, so offer the
                   upload instead of leaving an unverified talent no way back. */
                <label
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-primary-700 focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
                  title={t('cv_formats')}
                >
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {t('upload_cv')}
                  <input
                    type="file"
                    accept=".pdf,.docx,.pptx"
                    disabled={uploading}
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void handleUpload(file)
                    }}
                  />
                </label>
              ))}
          </div>
          {profile.bio && <p className="mt-3 text-sm text-on-surface-muted">{profile.bio}</p>}
          {/* Availability feeds the matching algorithm; the talent controls it. */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-medium text-on-surface-muted">
              {t('availability_label', 'Availability')}
            </span>
            <select
              value={profile.availabilityStatus}
              disabled={updateAvailability.isPending}
              onChange={(e) =>
                updateAvailability.mutate(
                  { profileId: profile.id, availability: e.target.value },
                  {
                    onSuccess: () => addToast('success', t('availability_updated')),
                    onError: () => addToast('error', t('availability_update_error')),
                  },
                )
              }
              className="rounded-lg border border-outline-dim/20 bg-surface px-2.5 py-1 text-xs font-medium text-primary-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30 disabled:opacity-50"
            >
              <option value="available">{t('availability_available', 'Available')}</option>
              <option value="busy">{t('availability_busy', 'Busy')}</option>
              <option value="unavailable">{t('availability_unavailable', 'Unavailable')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatsRow({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const stats = [
    {
      icon: <CheckCircle className="h-5 w-5 text-success-500" />,
      label: t('completed_projects'),
      value: String(profile.totalProjectsCompleted),
    },
    {
      icon: <Star className="h-5 w-5 text-warning-500" />,
      label: t('avg_rating'),
      value: profile.averageRating != null ? profile.averageRating.toFixed(1) : '-',
    },
    {
      icon: <Clock className="h-5 w-5 text-primary-500" />,
      label: t('active_projects'),
      value: String(profile.totalProjectsActive),
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-outline-dim/20 bg-surface-bright p-4"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-surface-container p-2">{stat.icon}</div>
            <div>
              <p className="text-sm text-on-surface-muted">{stat.label}</p>
              <p className="text-xl font-semibold text-primary-600">{stat.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
