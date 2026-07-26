import { cn } from '@/lib/utils'
import { type FormData, formatBudgetInput, INPUT_BASE, INPUT_ERROR, INPUT_NORMAL } from './shared'

export function Step2BudgetTimeline({
  form,
  errors,
  updateField,
  t,
}: {
  form: FormData
  errors: Record<string, string>
  updateField: (field: keyof FormData, value: string | string[]) => void
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-primary-600">{t('budget_timeline')}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="budgetMin" className="mb-1.5 block text-sm font-medium text-on-surface">
            {t('budget_min')} <span className="text-error-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-muted">
              Rp
            </span>
            <input
              id="budgetMin"
              type="text"
              inputMode="numeric"
              value={formatBudgetInput(form.budgetMin)}
              onChange={(e) => updateField('budgetMin', e.target.value.replace(/\D/g, ''))}
              placeholder={t('budget_min_placeholder')}
              className={cn(INPUT_BASE, 'pl-9', errors.budgetMin ? INPUT_ERROR : INPUT_NORMAL)}
            />
          </div>
          {errors.budgetMin && <p className="mt-1 text-xs text-error-500">{errors.budgetMin}</p>}
        </div>

        <div>
          <label htmlFor="budgetMax" className="mb-1.5 block text-sm font-medium text-on-surface">
            {t('budget_max')} <span className="text-error-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-muted">
              Rp
            </span>
            <input
              id="budgetMax"
              type="text"
              inputMode="numeric"
              value={formatBudgetInput(form.budgetMax)}
              onChange={(e) => updateField('budgetMax', e.target.value.replace(/\D/g, ''))}
              placeholder={t('budget_max_placeholder')}
              className={cn(INPUT_BASE, 'pl-9', errors.budgetMax ? INPUT_ERROR : INPUT_NORMAL)}
            />
          </div>
          {errors.budgetMax && <p className="mt-1 text-xs text-error-500">{errors.budgetMax}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="timeline" className="mb-1.5 block text-sm font-medium text-on-surface">
            {t('timeline')} <span className="text-error-500">*</span>
          </label>
          <input
            id="timeline"
            type="number"
            min="1"
            value={form.estimatedTimelineDays}
            onChange={(e) => updateField('estimatedTimelineDays', e.target.value)}
            placeholder={t('timeline_placeholder')}
            className={cn(INPUT_BASE, errors.estimatedTimelineDays ? INPUT_ERROR : INPUT_NORMAL)}
          />
          {errors.estimatedTimelineDays && (
            <p className="mt-1 text-xs text-error-500">{errors.estimatedTimelineDays}</p>
          )}
        </div>

        <div>
          <label htmlFor="deadline" className="mb-1.5 block text-sm font-medium text-on-surface">
            {t('deadline')}
          </label>
          <input
            id="deadline"
            type="date"
            value={form.deadline}
            onChange={(e) => updateField('deadline', e.target.value)}
            className={cn(INPUT_BASE, INPUT_NORMAL)}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Step 3: Preferences ── */
