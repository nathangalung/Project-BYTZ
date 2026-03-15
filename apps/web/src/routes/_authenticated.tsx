import { createFileRoute, Link, Outlet, redirect, useMatchRoute } from '@tanstack/react-router'
import {
  Bell,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Receipt,
  Search,
  Settings,
  User,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUnreadCount } from '@/hooks/use-notifications'
import i18n from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ location }) => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({ to: '/login' })
    }

    const path = location.pathname

    // Redirect worker to worker dashboard
    if (path === '/dashboard' && user?.role === 'worker') {
      throw redirect({ to: '/worker' })
    }

    // Block admin from main app
    if ((user?.role as string) === 'admin') {
      throw redirect({ to: '/login' })
    }

    // Protect worker routes (except /worker/register for onboarding)
    if (path.startsWith('/worker') && user?.role !== 'worker' && path !== '/worker/register') {
      throw redirect({ to: '/dashboard' })
    }

    // Protect client-only routes from workers
    if (path === '/projects/new' && user?.role !== 'client') {
      throw redirect({ to: '/worker' })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-primary-600">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-primary-900/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setSidebarOpen(false)}
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-auto">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 bg-primary-600">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation('common')
  const { user } = useAuthStore()
  const { data: unreadCount = 0 } = useUnreadCount()

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-primary-500/30 bg-primary-600 px-4 lg:justify-end lg:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-300 transition-colors hover:bg-primary-500/30 hover:text-warning-500 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => i18n.changeLanguage(i18n.language === 'id' ? 'en' : 'id')}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-500 hover:bg-primary-700 hover:text-neutral-300"
        >
          <Globe className="h-4 w-4" />
          {i18n.language === 'id' ? 'EN' : 'ID'}
        </button>
        <Link
          to="/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-neutral-300 transition-colors hover:bg-primary-500/30 hover:text-warning-500"
          aria-label={t('notifications', 'Notifikasi')}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-500 px-1 text-[10px] font-semibold text-primary-900">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Link
          to="/settings"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-primary-500/30 hover:text-neutral-200"
          aria-label={t('settings', 'Pengaturan')}
        >
          <Settings className="h-5 w-5" />
        </Link>
        <Link
          to={user?.role === 'worker' ? '/worker/profile' : '/settings'}
          className="ml-1 flex h-9 w-9 items-center justify-center rounded-full ring-2 ring-success-500 ring-offset-2 ring-offset-primary-600"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-600 text-sm font-bold text-warning-500">
              {(user?.name?.[0] ?? 'U').toUpperCase()}
            </span>
          )}
        </Link>
      </div>
    </header>
  )
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common')
  const { user } = useAuthStore()

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primary-800 transition-transform duration-200 lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-primary-700/50 px-6">
        <Link to="/dashboard" className="text-xl font-bold tracking-wider text-warning-500">
          BYTZ
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-primary-700 hover:text-neutral-200 lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          <SidebarLink
            to="/dashboard"
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Dashboard"
          />
          {user?.role === 'client' && (
            <>
              <SidebarLink
                to="/projects"
                icon={<FolderOpen className="h-4 w-4" />}
                label={t('projects', 'Proyek')}
              />
              <SidebarLink
                to="/payments"
                icon={<Receipt className="h-4 w-4" />}
                label={t('payments', 'Pembayaran')}
              />
              <SidebarLink
                to="/messages"
                icon={<MessageSquare className="h-4 w-4" />}
                label={t('messages', 'Pesan')}
              />
            </>
          )}
          {user?.role === 'worker' && (
            <>
              <SidebarLink
                to="/worker"
                icon={<Search className="h-4 w-4" />}
                label={t('browse_projects', 'Cari Proyek')}
              />
              <SidebarLink
                to="/payments"
                icon={<Receipt className="h-4 w-4" />}
                label={t('payments', 'Pembayaran')}
              />
              <SidebarLink
                to="/worker/profile"
                icon={<User className="h-4 w-4" />}
                label={t('worker_profile', 'Profil Worker')}
              />
            </>
          )}
        </ul>
      </nav>

      <div className="border-t border-primary-700/50 p-4">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-600 text-xs font-bold text-warning-500">
            {(user?.name?.[0] ?? 'U').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-100">{user?.name ?? 'User'}</p>
            <p className="truncate text-xs text-neutral-400">{user?.email ?? ''}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function SidebarLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const matchRoute = useMatchRoute()
  const isActive = matchRoute({ to, fuzzy: true })

  return (
    <li>
      <Link
        to={to}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'border-l-2 border-success-500 bg-primary-700/50 text-success-500'
            : 'border-l-2 border-transparent text-neutral-400 hover:bg-primary-700/30 hover:text-neutral-100',
        )}
      >
        {icon}
        {label}
      </Link>
    </li>
  )
}
