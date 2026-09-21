import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Stands where a withheld section would be.
 *
 * The server no longer sends the specification to a buyer who has not paid
 * for it, so the fields behind these sections arrive empty. Rendered as-is
 * that reads as a document the generator left blank - a defect - rather than
 * as the part of the purchase still to be unlocked, so the absence is
 * labelled instead of shown.
 */
export function DocumentLockedHint() {
  const { t } = useTranslation('project')

  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-outline-dim/30 bg-surface-container/50 px-4 py-3">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-muted" />
      <p className="text-xs text-on-surface-muted">{t('locked_section_hint')}</p>
    </div>
  )
}
