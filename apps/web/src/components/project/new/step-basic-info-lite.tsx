import { cn } from '@/lib/utils'
import { CATEGORIES, type FormData, INPUT_BASE, INPUT_ERROR, INPUT_NORMAL } from './shared'

/**
 * Title, category and description: the only part of basic info a visitor can
 * answer before signing in, and the part both intakes share.
 *
 * The public route used to carry its own copy of this markup, so the two could
 * drift on a label, an id or a validation style without anything failing. The
 * owner wizard now wraps this one with the fields that need an account
 * (document type, upload, company details), handed in as children so they keep
 * their place between the heading and these three.
 */
export function Step1BasicInfoLite({
  form,
  errors,
  updateField,
  t,
  children,
}: {
  form: FormData
  errors: Record<string, string>
  updateField: (field: keyof FormData, value: string | string[]) => void
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-brand-text">{t('basic_info')}</h2>

      {children}

      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('title')} <span className="text-error-500">*</span>
        </label>
        <input
          id="title"
          type="text"
          value={form.title}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder={t('title_placeholder')}
          className={cn(INPUT_BASE, errors.title ? INPUT_ERROR : INPUT_NORMAL)}
        />
        {errors.title && <p className="mt-1 text-xs text-error-500">{errors.title}</p>}
      </div>

      <div>
        <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('category')} <span className="text-error-500">*</span>
        </label>
        <select
          id="category"
          value={form.category}
          onChange={(e) => updateField('category', e.target.value)}
          className={cn(
            INPUT_BASE,
            !form.category && 'text-on-surface-muted',
            errors.category ? INPUT_ERROR : INPUT_NORMAL,
          )}
        >
          <option value="" disabled>
            {t('category_placeholder')}
          </option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {t(cat, cat)}
            </option>
          ))}
        </select>
        {errors.category && <p className="mt-1 text-xs text-error-500">{errors.category}</p>}
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('description')} <span className="text-error-500">*</span>
        </label>
        <textarea
          id="description"
          rows={5}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
          placeholder={t('description_placeholder')}
          className={cn(INPUT_BASE, 'resize-none', errors.description ? INPUT_ERROR : INPUT_NORMAL)}
        />
        {errors.description && <p className="mt-1 text-xs text-error-500">{errors.description}</p>}
      </div>
    </div>
  )
}
