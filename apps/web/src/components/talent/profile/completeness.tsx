import type { TFunction } from 'i18next'
import { Gauge } from 'lucide-react'
import { ProgressBar } from '@/components/ui/progress-bar'
import { profileCompleteness, type TalentProfile } from './shared'

/**
 * How far the profile is from being worth matching on.
 *
 * A partial profile is usable -- nothing here blocks anything -- but matching
 * reads skills, domain expertise and experience, and applying needs a CV. So
 * the bar names what is still missing rather than only scoring it.
 */
export function ProfileCompletenessCard({ profile, t }: { profile: TalentProfile; t: TFunction }) {
  const { percent, missing } = profileCompleteness(profile)

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-6">
      <div className="flex items-center gap-2">
        <Gauge className="h-5 w-5 text-brand-accent" />
        <h2 className="text-base font-semibold text-brand-text">{t('completeness_title')}</h2>
        <span className="ml-auto text-sm font-semibold text-brand-text">{percent}%</span>
      </div>
      <ProgressBar
        value={percent}
        label={t('completeness_title')}
        trackClassName="mt-3 h-2"
        barClassName="bg-brand-accent"
      />
      <p className="mt-3 text-xs text-on-surface-muted">
        {missing.length === 0 ? t('completeness_done') : t('completeness_optional')}
      </p>
      {missing.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {missing.map((field) => (
            <li
              key={field}
              className="rounded-full bg-surface-container px-2.5 py-1 text-xs text-on-surface-muted"
            >
              {t(`completeness_missing_${field}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
