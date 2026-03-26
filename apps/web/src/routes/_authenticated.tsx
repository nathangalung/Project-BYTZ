import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useMatchRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  Bell,
  FolderOpen,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Receipt,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useUnreadCount } from '@/hooks/use-notifications'
import i18n from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({ to: '/login' })
    }

    const path = location.pathname

    // Admin uses separate panel
    if ((user?.role as string) === 'admin') {
      throw redirect({ to: '/login' })
    }

    // Talent must complete profile first
    // Check localStorage cache first, then verify via API
    if (user?.role === 'talent' && path !== '/talent/register' && path !== '/settings') {
      const cachedProfile = localStorage.getItem('kerjacus-profile-complete')
      if (cachedProfile !== user.id) {
        try {
          const res = await fetch(
            `${(import.meta.env.VITE_API_URL as string) ?? ''}/api/v1/talent-profiles/me`,
            { credentials: 'include' },
          )
          if (res.ok) {
            const data = await res.json()
            if (
              data?.data?.verificationStatus === 'verified' ||
              data?.data?.verificationStatus === 'cv_parsing'
            ) {
              localStorage.setItem('kerjacus-profile-complete', user.id)
            } else {
              throw redirect({ to: '/talent/register' })
            }
          } else {
            throw redirect({ to: '/talent/register' })
          }
        } catch (e) {
          if (e && typeof e === 'object' && 'to' in e) throw e
          throw redirect({ to: '/talent/register' })
        }
      }
    }

    // Route protection: talent pages only for talent
    if (path.startsWith('/talent') && user?.role !== 'talent' && path !== '/talent/register') {
      throw redirect({ to: '/dashboard' })
    }

    // Route protection: project creation only for owner
    if (path === '/projects/new' && user?.role !== 'owner') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { pathname } = useRouterState({ select: (s) => s.location })
  const isFullscreen = pathname === '/talent/register'

  if (isFullscreen) {
    return (
      <div className="min-h-screen bg-surface">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-primary-900/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setSidebarOpen(false)}
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main id="main-content" className="flex-1 overflow-y-auto bg-surface-low">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation('common')
  const { user } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()
  const { data: unreadCount = 0 } = useUnreadCount()

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-outline-dim/20 bg-surface/90 px-4 backdrop-blur-xl lg:justify-end lg:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-on-surface-muted transition-colors hover:bg-surface-container hover:text-primary-500 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2">
        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-on-surface-muted transition-colors hover:bg-surface-container"
          title={theme === 'dark' ? t('light_mode') : t('dark_mode')}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {/* Language toggle */}
        <button
          type="button"
          onClick={() => i18n.changeLanguage(i18n.language === 'id' ? 'en' : 'id')}
          className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-medium text-on-surface-muted hover:bg-surface-container"
        >
          <Globe className="h-4 w-4" />
          {i18n.language === 'id' ? 'EN' : 'ID'}
        </button>
        <Link
          to="/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-xl text-on-surface-muted transition-colors hover:bg-surface-container hover:text-primary-500"
          aria-label={t('notifications')}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-coral-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Link
          to={user?.role === 'talent' ? '/talent/profile' : '/settings'}
          className="ml-1 flex h-9 w-9 items-center justify-center rounded-full ring-2 ring-primary-500 ring-offset-2 ring-offset-surface"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-500/10 text-sm font-bold text-primary-600">
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
  const navigate = useNavigate()

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primary-800 transition-transform duration-200 lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      {/* Decorative glow */}
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-accent-coral-500/10 blur-3xl" />

      <div className="flex h-16 items-center justify-between border-b border-white/10 px-6">
        <Link to="/dashboard" className="text-xl font-extrabold tracking-tight">
          <span className="text-white">Kerja</span>
          <span className="text-accent-coral-500">CUS</span>
          <span className="text-white">!</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="px-6 pt-2 text-xs text-white/40">
        {user?.role === 'talent' ? t('panel_talent') : t('panel_client')}
      </p>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          <SidebarLink
            to="/dashboard"
            icon={<LayoutDashboard className="h-4 w-4" />}
            label={t('dashboard')}
          />
          {/* Browse Projects — same for both roles */}
          <SidebarLink
            to="/browse"
            icon={<Search className="h-4 w-4" />}
            label={t('browse_projects')}
          />
          {/* My Projects — role-specific route */}
          <SidebarLink
            to={user?.role === 'talent' ? '/talent' : '/projects'}
            icon={<FolderOpen className="h-4 w-4" />}
            label={t('my_projects')}
          />
          {/* Payments & Messages — same for both */}
          <SidebarLink
            to="/payments"
            icon={<Receipt className="h-4 w-4" />}
            label={t('payments')}
          />
          <SidebarLink
            to="/messages"
            icon={<MessageSquare className="h-4 w-4" />}
            label={t('messages')}
          />
        </ul>
      </nav>

      <div className="relative z-10 border-t border-white/10 p-4">
        <button
          type="button"
          onClick={() => {
            useAuthStore.getState().logout()
            navigate({ to: '/login' })
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/60 transition-all hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          {t('logout')}
        </button>
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
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all',
          isActive ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
        )}
      >
        {icon}
        {label}
      </Link>
    </li>
  )
}
