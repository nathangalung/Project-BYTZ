import { Link, useMatchRoute } from '@tanstack/react-router'
import { Globe, Menu, Moon, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme'

export function PublicHeader() {
  const { t } = useTranslation('common')
  const { theme, toggleTheme } = useThemeStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navItems = [
    { to: '/', label: t('home'), exact: true },
    { to: '/request-project', label: t('submit_project') },
    { to: '/browse-projects', label: t('browse_projects') },
    { to: '/about', label: t('about_us') },
  ]

  return (
    <nav
      aria-label="Main navigation"
      className="sticky top-0 z-50 border-b border-outline-dim/20 bg-surface/90 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6 md:px-10 md:py-4">
        {/* Logo */}
        <Link to="/" className="text-xl font-extrabold tracking-tight sm:text-2xl">
          <span className="text-primary-600">Kerja</span>
          <span className="text-accent-coral-600">CUS</span>
          <span className="text-primary-600">!</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 text-sm font-semibold md:flex">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} label={item.label} exact={item.exact} />
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('light_mode') : t('dark_mode')}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-on-surface-muted hover:bg-surface-container transition-colors"
          >
            {theme === 'dark' ? (
              <Sun aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Moon aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => i18n.changeLanguage(i18n.language === 'id' ? 'en' : 'id')}
            aria-label={`${t('change_language')}: ${i18n.language === 'id' ? 'English' : 'Indonesia'}`}
            className="flex items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium text-on-surface-muted hover:bg-surface-container transition-colors sm:px-3 sm:text-sm"
          >
            <Globe aria-hidden="true" className="h-4 w-4" />
            <span>{i18n.language === 'id' ? 'EN' : 'ID'}</span>
          </button>
          <Link
            to="/login"
            className="hidden px-3 py-2 text-sm font-bold text-primary-600 transition-colors hover:text-accent-coral-600 sm:block"
          >
            {t('login')}
          </Link>
          <Link
            to="/register"
            className="rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white transition-all hover:opacity-90 active:scale-95 sm:px-5 sm:py-2.5 sm:text-sm"
          >
            {t('register')}
          </Link>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? t('close_menu') : t('open_menu')}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-muted hover:bg-surface-container md:hidden"
          >
            {mobileOpen ? (
              <X aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Menu aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="border-t border-outline-dim/10 bg-surface px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-on-surface-muted transition-colors hover:bg-surface-container hover:text-primary-600"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-semibold text-primary-600 sm:hidden"
            >
              {t('login')}
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}

function NavLink({ to, label, exact }: { to: string; label: string; exact?: boolean }) {
  const matchRoute = useMatchRoute()
  const isActive = exact ? matchRoute({ to }) : matchRoute({ to, fuzzy: true })

  return (
    <Link
      to={to}
      className={cn(
        'relative px-3 py-2 rounded-lg transition-colors',
        isActive ? 'text-primary-600' : 'text-on-surface-muted hover:text-accent-coral-600',
      )}
    >
      {label}
      {isActive && (
        <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary-500" />
      )}
    </Link>
  )
}
