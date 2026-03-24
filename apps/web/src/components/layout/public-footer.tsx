import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export function PublicFooter() {
  const { t } = useTranslation('common')

  return (
    <footer className="border-t border-outline-dim/20 bg-surface-bright py-10">
      <div className="mx-auto max-w-screen-2xl px-6 md:px-10">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div className="max-w-sm">
            <div className="mb-3 text-2xl font-extrabold tracking-tight">
              <span className="text-primary-600">Kerja</span>
              <span className="text-accent-coral-600">CUS</span>
              <span className="text-primary-600">!</span>
            </div>
            <p className="text-sm leading-relaxed text-on-surface-muted">{t('footer_desc')}</p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-on-surface-muted">
            <Link to="/" className="transition-colors hover:text-accent-coral-600">
              {t('home')}
            </Link>
            <Link to="/request-project" className="transition-colors hover:text-accent-coral-600">
              {t('submit_project')}
            </Link>
            <Link to="/browse-projects" className="transition-colors hover:text-accent-coral-600">
              {t('browse_projects')}
            </Link>
            <Link to="/about" className="transition-colors hover:text-accent-coral-600">
              {t('about_us')}
            </Link>
            <Link to="/login" className="transition-colors hover:text-accent-coral-600">
              {t('login')}
            </Link>
            <Link to="/register" className="transition-colors hover:text-accent-coral-600">
              {t('register')}
            </Link>
          </nav>
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-outline-dim/20 pt-6 text-xs text-on-surface-muted md:flex-row">
          <p>&copy; {new Date().getFullYear()} KerjaCUS!</p>
          <div className="flex gap-4">
            <span>{t('terms')}</span>
            <span>{t('privacy')}</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
