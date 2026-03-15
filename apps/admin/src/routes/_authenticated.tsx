import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router'
import {
  AlertTriangle,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Shield,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: () => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated || user?.role !== 'admin') {
      throw redirect({ to: '/' })
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
  const { t } = useTranslation('admin')
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore network errors on logout
    }
    logout()
    navigate({ to: '/' })
  }

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

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-sm text-neutral-400">{user?.name ?? 'Admin'}</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-neutral-400 transition-colors hover:bg-primary-500/30 hover:text-error-500"
          aria-label={t('logout')}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{t('logout')}</span>
        </button>
      </div>
    </header>
  )
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('admin')
  const { user } = useAuthStore()

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primary-800 transition-transform duration-200 lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-primary-700/50 px-6">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 text-xl font-bold tracking-wider text-warning-500"
        >
          <Shield className="h-5 w-5" />
          BYTZ Admin
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
            label={t('nav_dashboard')}
          />
          <SidebarLink to="/users" icon={<Users className="h-4 w-4" />} label={t('nav_users')} />
          <SidebarLink
            to="/projects"
            icon={<FolderOpen className="h-4 w-4" />}
            label={t('nav_projects')}
          />
          <SidebarLink
            to="/finance"
            icon={<Wallet className="h-4 w-4" />}
            label={t('nav_finance')}
          />
          <SidebarLink
            to="/disputes"
            icon={<AlertTriangle className="h-4 w-4" />}
            label={t('nav_disputes')}
          />
          <SidebarLink
            to="/audit-log"
            icon={<ScrollText className="h-4 w-4" />}
            label={t('nav_audit_log')}
          />
          <SidebarLink
            to="/settings"
            icon={<Settings className="h-4 w-4" />}
            label={t('nav_settings')}
          />
        </ul>
      </nav>

      <div className="border-t border-primary-700/50 p-4">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-600 text-xs font-bold text-warning-500">
            {(user?.name?.[0] ?? 'A').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-100">{user?.name ?? 'Admin'}</p>
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
