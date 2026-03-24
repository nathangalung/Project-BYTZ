import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Bell,
  BellOff,
  Briefcase,
  CheckCheck,
  ChevronRight,
  FolderOpen,
  Info,
  Loader2,
  Target,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMarkAllRead, useMarkRead, useNotifications } from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/notifications')({
  component: NotificationsPage,
})

type FilterTab = 'all' | 'projects' | 'payments' | 'system'

const NOTIFICATION_ICONS: Record<string, React.ReactNode> = {
  project_match: <Target className="h-5 w-5 text-accent-coral-600" />,
  application_update: <Briefcase className="h-5 w-5 text-primary-600" />,
  milestone_update: <FolderOpen className="h-5 w-5 text-accent-coral-600" />,
  payment: <Wallet className="h-5 w-5 text-accent-coral-600" />,
  dispute: <AlertTriangle className="h-5 w-5 text-error-500" />,
  team_formation: <Users className="h-5 w-5 text-primary-600" />,
  assignment_offer: <Briefcase className="h-5 w-5 text-primary-600" />,
  system: <Info className="h-5 w-5 text-primary-600" />,
}

function mapFilterToApiType(filter: FilterTab): string | undefined {
  if (filter === 'all') return undefined
  if (filter === 'projects')
    return 'project_match,milestone_update,team_formation,assignment_offer,application_update'
  if (filter === 'payments') return 'payment'
  if (filter === 'system') return 'system,dispute'
  return undefined
}

function NotificationsPage() {
  const { t } = useTranslation('common')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

  const { data, isLoading } = useNotifications(1, mapFilterToApiType(activeFilter))
  const markReadMutation = useMarkRead()
  const markAllReadMutation = useMarkAllRead()

  const notifications = data?.items ?? []
  const unreadCount = notifications.filter((n) => !n.isRead).length

  function markAllRead() {
    markAllReadMutation.mutate()
  }

  function markRead(id: string) {
    markReadMutation.mutate(id)
  }

  const filtered = notifications

  const filterLabels: Record<FilterTab, string> = {
    all: t('all', 'Semua'),
    projects: t('projects', 'Proyek'),
    payments: t('payments', 'Pembayaran'),
    system: t('system', 'Sistem'),
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-primary-600">
              {t('notifications', 'Notifikasi')}
            </h1>
            {unreadCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-error-500 px-2.5 py-0.5 text-xs font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/20 px-3 py-2 text-sm font-medium text-on-surface-muted transition-colors hover:bg-surface-container"
            >
              <CheckCheck className="h-4 w-4" />
              {t('mark_all_read', 'Tandai Semua Dibaca')}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-on-surface-muted">
          {t('notifications_subtitle', 'Pantau semua pembaruan di satu tempat')}
        </p>

        {/* Filter tabs */}
        <div className="mt-4 flex gap-2">
          {(['all', 'projects', 'payments', 'system'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveFilter(tab)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
                activeFilter === tab
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-container text-on-surface-muted hover:bg-surface-container/80 hover:text-on-surface-muted',
              )}
            >
              {filterLabels[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications list */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-16">
          <Loader2 className="h-8 w-8 animate-spin text-success-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-16">
          <BellOff className="h-12 w-12 text-on-surface-muted" />
          <h3 className="mt-4 text-lg font-semibold text-on-surface-muted">
            {t('no_notifications', 'Belum ada notifikasi')}
          </h3>
          <p className="mt-1 text-sm text-on-surface-muted">
            {t('no_notifications_description', 'Notifikasi akan muncul di sini saat ada pembaruan')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => markRead(notification.id)}
              className={cn(
                'flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-colors',
                notification.isRead
                  ? 'border-outline-dim/20 bg-surface-bright hover:bg-surface-bright/80'
                  : 'border-success-500/20 bg-surface-bright hover:bg-surface-bright/80',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  notification.isRead ? 'bg-surface-container' : 'bg-surface-container',
                )}
              >
                {NOTIFICATION_ICONS[notification.type] ?? (
                  <Bell className="h-5 w-5 text-on-surface-muted" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className={cn(
                      'text-sm',
                      notification.isRead
                        ? 'font-medium text-on-surface-muted'
                        : 'font-semibold text-primary-600',
                    )}
                  >
                    {notification.title}
                  </h3>
                  <div className="flex shrink-0 items-center gap-2">
                    {!notification.isRead && (
                      <span className="h-2.5 w-2.5 rounded-full bg-error-500" />
                    )}
                    <span className="text-xs text-on-surface-muted">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 text-sm text-on-surface-muted">{notification.message}</p>
                {notification.link && (
                  <span className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-accent-coral-600">
                    {t('view_details', 'Lihat Detail')}
                    <ChevronRight className="h-3 w-3" />
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}
