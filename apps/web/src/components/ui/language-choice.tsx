import { useTranslation } from 'react-i18next'
import type { DocLanguage } from '@/hooks/use-projects'
import { cn } from '@/lib/utils'

// Owner picks the BRD/PRD document language before generating.
export function LanguageChoice({
  value,
  onChange,
  disabled,
}: {
  value: DocLanguage
  onChange: (value: DocLanguage) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('document')
  return (
    <fieldset
      aria-label={t('document_language')}
      className="m-0 inline-flex min-w-0 items-center gap-0.5 rounded-lg border border-outline-dim/20 p-0.5"
    >
      {(['id', 'en'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          disabled={disabled}
          aria-pressed={value === lang}
          onClick={() => onChange(lang)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50',
            value === lang
              ? 'bg-brand text-white'
              : 'text-on-surface-muted hover:bg-surface-container',
          )}
        >
          {t(`language_${lang}`)}
        </button>
      ))}
    </fieldset>
  )
}
