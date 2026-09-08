import { useTranslation } from 'react-i18next'
import { timelineBracketKey } from '@/lib/timeline-range'

/** The range the owner chose, or the integer when there was no range. */
export function TimelineRange({ days }: { days: number | null | undefined }) {
  const { t } = useTranslation('project')
  const key = timelineBracketKey(days)

  if (key) return <>{t(key)}</>
  if (typeof days !== 'number') return <>{t('timeline_unknown')}</>
  return (
    <>
      {days} {t('days')}
    </>
  )
}
