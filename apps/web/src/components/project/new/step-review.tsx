import { cn, formatCurrency } from '@/lib/utils'
import { type FormData, parseBudget } from './shared'

export function Step4Review({
  form,
  t,
}: {
  form: FormData
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-brand-text">{t('review_submit')}</h2>

      <div className="rounded-lg border border-outline-dim/20 bg-surface-container p-5">
        <h3 className="mb-4 text-sm font-semibold text-brand-text/80">
          {t('review_section_basic')}
        </h3>
        <dl className="space-y-3">
          <ReviewItem label={t('title')} value={form.title} />
          <ReviewItem label={t('category')} value={t(form.category, form.category)} />
          <ReviewItem label={t('description')} value={form.description} multiline />
          {form.documentType && (
            <ReviewItem
              label={t('document_type')}
              value={
                form.documentType === 'brd'
                  ? 'BRD'
                  : form.documentType === 'prd'
                    ? 'PRD'
                    : 'BRD & PRD'
              }
            />
          )}
          {form.documentFileKey && (
            <ReviewItem label={t('document_uploaded')} value={t('document_attached')} />
          )}
        </dl>
      </div>

      <div className="rounded-lg border border-outline-dim/20 bg-surface-container p-5">
        <h3 className="mb-4 text-sm font-semibold text-brand-text/80">
          {t('review_section_budget')}
        </h3>
        <dl className="space-y-3">
          <ReviewItem label={t('budget_min')} value={formatCurrency(parseBudget(form.budgetMin))} />
          <ReviewItem label={t('budget_max')} value={formatCurrency(parseBudget(form.budgetMax))} />
          <ReviewItem label={t('timeline')} value={`${form.estimatedTimelineDays} ${t('days')}`} />
          {form.deadline && <ReviewItem label={t('deadline')} value={form.deadline} />}
        </dl>
      </div>

      <div className="rounded-lg border border-outline-dim/20 bg-surface-container p-5">
        <h3 className="mb-4 text-sm font-semibold text-brand-text/80">
          {t('review_section_preferences')}
        </h3>
        <dl className="space-y-3">
          <ReviewItem label={t('almamater')} value={form.almamater || t('not_specified')} />
          <ReviewItem
            label={t('min_experience')}
            value={form.minExperience ? `${form.minExperience} ${t('years')}` : t('not_specified')}
          />
          <div className="flex items-start gap-3">
            <dt className="w-40 shrink-0 text-xs text-on-surface-muted">{t('required_skills')}</dt>
            <dd className="text-sm text-on-surface">
              {form.requiredSkills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.requiredSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-brand-accent/10 px-2.5 py-0.5 text-xs font-medium text-brand-text"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-on-surface-muted">{t('not_specified')}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

/* ── Review Item ── */

export function ReviewItem({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div className={cn('flex gap-3', multiline ? 'flex-col' : 'items-start')}>
      <dt className="w-40 shrink-0 text-xs text-on-surface-muted">{label}</dt>
      <dd className={cn('text-sm text-on-surface', multiline && 'whitespace-pre-wrap')}>{value}</dd>
    </div>
  )
}
