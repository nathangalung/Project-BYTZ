import { ArrowLeft, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  type BriefFormData,
  BUDGET_RANGES,
  DEADLINE_RANGES,
  INPUT_BASE,
  INPUT_ERROR,
  INPUT_NORMAL,
  PLATFORM_OPTIONS,
} from './shared'

export function PathBForm({
  briefForm,
  briefErrors,
  updateBriefField,
  togglePlatform,
  handleBriefSubmit,
  handleBackToChooser,
}: {
  briefForm: BriefFormData
  briefErrors: Record<string, string>
  updateBriefField: (field: keyof BriefFormData, value: string | string[]) => void
  togglePlatform: (platform: string) => void
  handleBriefSubmit: () => void
  handleBackToChooser: () => void
}) {
  const { t } = useTranslation('project')

  const title = t('path_b_form_title')

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleBackToChooser}
          className="rounded-xl p-2 transition-colors hover:bg-surface-container"
        >
          <ArrowLeft className="h-5 w-5 text-on-surface-muted" />
        </button>
        <div>
          <h3 className="text-xl font-extrabold text-brand-text">{title}</h3>
          <p className="mt-0.5 text-xs text-on-surface-muted">{t('brief_form_subtitle')}</p>
        </div>
      </div>

      <div className="rounded-3xl border border-outline-dim/20 bg-surface-bright p-7 space-y-5">
        {/* Row: Title + Industry */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="brief-title"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
            >
              {t('brief_title')} <span className="text-error-500">*</span>
            </label>
            <input
              id="brief-title"
              type="text"
              value={briefForm.title}
              onChange={(e) => updateBriefField('title', e.target.value)}
              placeholder={t('brief_title_placeholder')}
              className={cn(INPUT_BASE, briefErrors.title ? INPUT_ERROR : INPUT_NORMAL)}
            />
            {briefErrors.title && (
              <p className="mt-1 text-xs text-error-500">{briefErrors.title}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="brief-industry"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
            >
              {t('brief_industry')}
            </label>
            <input
              id="brief-industry"
              type="text"
              value={briefForm.industry}
              onChange={(e) => updateBriefField('industry', e.target.value)}
              placeholder={t('brief_industry_placeholder')}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            />
          </div>
        </div>

        {/* Problem */}
        <div>
          <label
            htmlFor="brief-problem"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
          >
            {t('brief_problem')} <span className="text-error-500">*</span>
          </label>
          <textarea
            id="brief-problem"
            rows={2}
            value={briefForm.problem}
            onChange={(e) => updateBriefField('problem', e.target.value)}
            placeholder={t('brief_problem_placeholder')}
            className={cn(
              INPUT_BASE,
              'resize-none',
              briefErrors.problem ? INPUT_ERROR : INPUT_NORMAL,
            )}
          />
          {briefErrors.problem && (
            <p className="mt-1 text-xs text-error-500">{briefErrors.problem}</p>
          )}
        </div>

        {/* Target Users */}
        <div>
          <label
            htmlFor="brief-target"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
          >
            {t('brief_target_users')} <span className="text-error-500">*</span>
          </label>
          <input
            id="brief-target"
            type="text"
            value={briefForm.targetUsers}
            onChange={(e) => updateBriefField('targetUsers', e.target.value)}
            placeholder={t('brief_target_placeholder')}
            className={cn(INPUT_BASE, briefErrors.targetUsers ? INPUT_ERROR : INPUT_NORMAL)}
          />
          {briefErrors.targetUsers && (
            <p className="mt-1 text-xs text-error-500">{briefErrors.targetUsers}</p>
          )}
        </div>

        {/* Main Features */}
        <div>
          <label
            htmlFor="brief-features"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
          >
            {t('brief_main_features')} <span className="text-error-500">*</span>
          </label>
          <textarea
            id="brief-features"
            rows={2}
            value={briefForm.mainFeatures}
            onChange={(e) => updateBriefField('mainFeatures', e.target.value)}
            placeholder={t('brief_features_placeholder')}
            className={cn(
              INPUT_BASE,
              'resize-none',
              briefErrors.mainFeatures ? INPUT_ERROR : INPUT_NORMAL,
            )}
          />
          {briefErrors.mainFeatures && (
            <p className="mt-1 text-xs text-error-500">{briefErrors.mainFeatures}</p>
          )}
        </div>

        {/* Row: Budget + Deadline */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="brief-budget"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
            >
              {t('brief_budget')}
            </label>
            <select
              id="brief-budget"
              value={briefForm.budgetRange}
              onChange={(e) => updateBriefField('budgetRange', e.target.value)}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            >
              <option value="">{t('budget_not_decided')}</option>
              {BUDGET_RANGES.filter((r) => r !== 'budget_not_decided').map((range) => (
                <option key={range} value={range}>
                  {t(range, range)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="brief-deadline"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
            >
              {t('brief_deadline')}
            </label>
            <select
              id="brief-deadline"
              value={briefForm.deadlineRange}
              onChange={(e) => updateBriefField('deadlineRange', e.target.value)}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            >
              <option value="">{t('deadline_flexible')}</option>
              {DEADLINE_RANGES.filter((r) => r !== 'deadline_flexible').map((range) => (
                <option key={range} value={range}>
                  {t(range, range)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Platforms */}
        <div>
          <label
            htmlFor="brief-platforms"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
          >
            {t('brief_platforms')}
          </label>
          <div id="brief-platforms" className="mt-1 flex flex-wrap gap-3">
            {PLATFORM_OPTIONS.map((platform) => (
              <label
                key={platform}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-on-surface"
              >
                <input
                  type="checkbox"
                  checked={briefForm.platforms.includes(platform)}
                  onChange={() => togglePlatform(platform)}
                  className="accent-primary-600"
                />
                {platform}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={handleBriefSubmit}
          className="inline-flex items-center gap-2 rounded-2xl bg-brand px-8 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:opacity-90 hover:shadow-lg"
        >
          <Sparkles className="h-4 w-4" />
          {t('generate_brd_with_ai')}
        </button>
      </div>
    </div>
  )
}

/* ── Step Indicator ── */
