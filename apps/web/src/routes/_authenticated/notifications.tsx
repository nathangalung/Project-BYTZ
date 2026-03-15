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
  Target,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/notifications')({
  component: NotificationsPage,
})

type FilterTab = 'all' | 'projects' | 'payments' | 'system'

type Notification = {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  link: string | null
  createdAt: string
}

const NOTIFICATION_ICONS: Record<string, React.ReactNode> = {
  project_match: <Target className="h-5 w-5 text-success-500" />,
  application_update: <Briefcase className="h-5 w-5 text-warning-500" />,
  milestone_update: <FolderOpen className="h-5 w-5 text-success-500" />,
  payment: <Wallet className="h-5 w-5 text-success-500" />,
  dispute: <AlertTriangle className="h-5 w-5 text-error-500" />,
  team_formation: <Users className="h-5 w-5 text-warning-500" />,
  assignment_offer: <Briefcase className="h-5 w-5 text-warning-500" />,
  system: <Info className="h-5 w-5 text-warning-500" />,
}

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    type: 'project_match',
    title: 'Proyek baru cocok dengan skill Anda',
    message: 'E-commerce Platform UMKM membutuhkan Backend Developer. Lihat detail proyek.',
    isRead: false,
    link: '/projects/p1',
    createdAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: 'n2',
    type: 'milestone_update',
    title: 'Milestone di-approve',
    message:
      'Milestone "Backend API v1" pada proyek Dashboard Analytics telah di-approve oleh client.',
    isRead: false,
    link: '/projects/p3',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'n3',
    type: 'payment',
    title: 'Pembayaran diterima',
    message: 'Rp 12.000.000 telah dicairkan ke akun Anda untuk milestone Backend API.',
    isRead: false,
    link: '/payments/t5',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'n4',
    type: 'dispute',
    title: 'Dispute baru pada proyek Anda',
    message: 'Client membuka dispute untuk proyek Chatbot Customer Service. Segera tanggapi.',
    isRead: false,
    link: '/projects/p7',
    createdAt: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    id: 'n5',
    type: 'team_formation',
    title: 'Tim proyek telah lengkap',
    message:
      'Semua posisi untuk proyek Mobile Fitness App telah terisi. Proyek akan segera dimulai.',
    isRead: true,
    link: '/projects/p8',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'n6',
    type: 'system',
    title: 'Pembaruan platform',
    message: 'BYTZ telah memperbarui kebijakan escrow. Baca selengkapnya di pusat bantuan.',
    isRead: true,
    link: null,
    createdAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'n7',
    type: 'assignment_offer',
    title: 'Tawaran assignment baru',
    message:
      'Anda direkomendasikan untuk work package Frontend Development di proyek Sistem Inventori.',
    isRead: true,
    link: '/projects/p5',
    createdAt: new Date(Date.now() - 259200000).toISOString(),
  },
  {
    id: 'n8',
    type: 'payment',
    title: 'Escrow deposit diterima',
    message: 'Client telah melakukan deposit escrow Rp 55.000.000 untuk proyek E-commerce UMKM.',
    isRead: true,
    link: '/payments/t1',
    createdAt: new Date(Date.now() - 345600000).toISOString(),
  },
  {
    id: 'n9',
    type: 'milestone_update',
    title: 'Revisi diminta',
    message:
      'Client meminta revisi untuk milestone "UI Dashboard" pada proyek Dashboard Analytics.',
    isRead: true,
    link: '/projects/p3',
    createdAt: new Date(Date.now() - 432000000).toISOString(),
  },
  {
    id: 'n10',
    type: 'application_update',
    title: 'Lamaran diterima',
    message: 'Lamaran Anda untuk proyek Mobile Booking App telah diterima. Cek detail assignment.',
    isRead: true,
    link: '/projects/p2',
    createdAt: new Date(Date.now() - 518400000).toISOString(),
  },
]

function NotificationsPage() {
  const { t } = useTranslation('common')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS)

  const unreadCount = notifications.filter((n) => !n.isRead).length

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
  }

  function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
  }

  const filtered = notifications.filter((n) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'projects')
      return [
        'project_match',
        'milestone_update',
        'team_formation',
        'assignment_offer',
        'application_update',
      ].includes(n.type)
    if (activeFilter === 'payments') return n.type === 'payment'
    if (activeFilter === 'system') return n.type === 'system' || n.type === 'dispute'
    return true
  })

  const filterLabels: Record<FilterTab, string> = {
    all: t('all', 'Semua'),
    projects: t('projects', 'Proyek'),
    payments: t('payments', 'Pembayaran'),
    system: t('system', 'Sistem'),
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-warning-500">
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-600/50 px-3 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-primary-700"
            >
              <CheckCheck className="h-4 w-4" />
              {t('mark_all_read', 'Tandai Semua Dibaca')}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
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
                  ? 'bg-success-500 text-primary-800'
                  : 'bg-primary-700 text-neutral-500 hover:bg-primary-700/80 hover:text-neutral-400',
              )}
            >
              {filterLabels[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-600/30 bg-neutral-600 py-16">
          <BellOff className="h-12 w-12 text-neutral-600" />
          <h3 className="mt-4 text-lg font-semibold text-neutral-400">
            {t('no_notifications', 'Belum ada notifikasi')}
          </h3>
          <p className="mt-1 text-sm text-neutral-500">
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
                  ? 'border-neutral-600/30 bg-neutral-600 hover:bg-neutral-600/80'
                  : 'border-success-500/20 bg-neutral-600 hover:bg-neutral-600/80',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  notification.isRead ? 'bg-primary-700' : 'bg-primary-700',
                )}
              >
                {NOTIFICATION_ICONS[notification.type] ?? (
                  <Bell className="h-5 w-5 text-neutral-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className={cn(
                      'text-sm',
                      notification.isRead
                        ? 'font-medium text-neutral-400'
                        : 'font-semibold text-warning-500',
                    )}
                  >
                    {notification.title}
                  </h3>
                  <div className="flex shrink-0 items-center gap-2">
                    {!notification.isRead && (
                      <span className="h-2.5 w-2.5 rounded-full bg-error-500" />
                    )}
                    <span className="text-xs text-neutral-600">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 text-sm text-neutral-500">{notification.message}</p>
                {notification.link && (
                  <span className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-success-500">
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

  if (diffMinutes < 1) return 'baru saja'
  if (diffMinutes < 60) return `${diffMinutes}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}
