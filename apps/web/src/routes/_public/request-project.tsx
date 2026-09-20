import { ProjectVisibility } from '@kerjacus/shared'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, Check, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CATEGORIES,
  type FormData,
  INPUT_BASE,
  INPUT_ERROR,
  INPUT_NORMAL,
  parseBudget,
  STEPS,
  step1Schema,
  step2Schema,
} from '@/components/project/new/shared'
import { Step2BudgetTimeline } from '@/components/project/new/step-budget-timeline'
import { StepIndicator } from '@/components/project/new/step-indicator'
import { Step3Preferences } from '@/components/project/new/step-preferences'
import { Step4Review } from '@/components/project/new/step-review'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_public/request-project')({
  component: RequestProjectPage,
})

const DRAFT_KEY = 'kerjacus-draft-project'

/**
 * The public intake and the owner wizard are the same form. This route renders
 * the shared step components so a visitor sees exactly what a signed-in owner
 * sees, minus the two steps that need an account (document upload and company
 * details). It saves a draft under the FormData field names the owner wizard
 * reads back, so the handoff across sign-up loses nothing and needs no key
 * translation.
 */
function RequestProjectPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()

  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [skillInput, setSkillInput] = useState('')
  const [form, setForm] = useState<FormData>({
    title: '',
    description: '',
    category: '',
    budgetMin: '',
    budgetMax: '',
    estimatedTimelineDays: '',
    deadline: '',
    almamater: '',
    minExperience: '',
    requiredSkills: [],
    visibility: ProjectVisibility.PUBLIC_SUMMARY,
    documentFileKey: '',
    documentType: '',
  })

  const updateField = useCallback((field: keyof FormData, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  function addSkill(skill: string) {
    const trimmed = skill.trim()
    if (trimmed && !form.requiredSkills.includes(trimmed)) {
      updateField('requiredSkills', [...form.requiredSkills, trimmed])
    }
    setSkillInput('')
  }

  function removeSkill(skill: string) {
    updateField(
      'requiredSkills',
      form.requiredSkills.filter((s) => s !== skill),
    )
  }

  function validateStep(target: number): boolean {
    const next: Record<string, string> = {}
    if (target === 0) {
      const result = step1Schema.safeParse({
        title: form.title,
        description: form.description,
        category: form.category,
      })
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string
          if (field === 'title') {
            next.title =
              form.title.length === 0 ? t('validation_title_required') : t('validation_title_min')
          }
          if (field === 'description') {
            next.description =
              form.description.length === 0
                ? t('validation_description_required')
                : t('validation_description_min')
          }
          if (field === 'category') next.category = t('validation_category_required')
        }
      }
    }
    if (target === 1) {
      const result = step2Schema.safeParse({
        budgetMin: form.budgetMin,
        budgetMax: form.budgetMax,
        estimatedTimelineDays: form.estimatedTimelineDays,
      })
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string
          if (field === 'budgetMin') next.budgetMin = t('validation_budget_min_required')
          if (field === 'budgetMax') next.budgetMax = t('validation_budget_max_required')
          if (field === 'estimatedTimelineDays') {
            next.estimatedTimelineDays = t('validation_timeline_required')
          }
        }
      }
      if (
        !next.budgetMin &&
        !next.budgetMax &&
        parseBudget(form.budgetMax) < parseBudget(form.budgetMin)
      ) {
        next.budgetMax = t('validation_budget_max_below_min')
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleNext() {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function saveDraft() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          title: form.title,
          description: form.description,
          category: form.category,
          budgetMin: form.budgetMin,
          budgetMax: form.budgetMax,
          estimatedTimelineDays: form.estimatedTimelineDays,
          almamater: form.almamater,
          minExperience: form.minExperience,
          requiredSkills: form.requiredSkills,
          visibility: form.visibility,
        }),
      )
    } catch {
      // A browser refusing storage still lets the owner continue signed in.
    }
  }

  function handleSubmit() {
    if (!validateStep(0) || !validateStep(1)) return
    saveDraft()
    if (isAuthenticated) {
      navigate({ to: '/projects/new' })
    } else {
      setShowLoginPrompt(true)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold text-brand-text">{t('new_project')}</h1>
      <p className="mt-1 text-sm text-on-surface-muted">{t('request_project_desc')}</p>

      <div className="mt-8">
        <StepIndicator currentStep={step} />
      </div>

      <div className="mt-8 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-brand-text">{t('basic_info')}</h2>
            <div>
              <label
                htmlFor="rp-title"
                className="mb-1.5 block text-sm font-medium text-on-surface"
              >
                {t('title')} <span className="text-error-500">*</span>
              </label>
              <input
                id="rp-title"
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder={t('title_placeholder')}
                className={cn(INPUT_BASE, errors.title ? INPUT_ERROR : INPUT_NORMAL)}
              />
              {errors.title && <p className="mt-1 text-xs text-error-500">{errors.title}</p>}
            </div>
            <div>
              <label
                htmlFor="rp-category"
                className="mb-1.5 block text-sm font-medium text-on-surface"
              >
                {t('category')} <span className="text-error-500">*</span>
              </label>
              <select
                id="rp-category"
                value={form.category}
                onChange={(e) => updateField('category', e.target.value)}
                className={cn(
                  INPUT_BASE,
                  errors.category ? INPUT_ERROR : INPUT_NORMAL,
                  !form.category && 'text-on-surface-muted',
                )}
              >
                <option value="" disabled>
                  {t('category_placeholder')}
                </option>
                {CATEGORIES.map((key) => (
                  <option key={key} value={key}>
                    {t(key)}
                  </option>
                ))}
              </select>
              {errors.category && <p className="mt-1 text-xs text-error-500">{errors.category}</p>}
            </div>
            <div>
              <label htmlFor="rp-desc" className="mb-1.5 block text-sm font-medium text-on-surface">
                {t('description')} <span className="text-error-500">*</span>
              </label>
              <textarea
                id="rp-desc"
                rows={5}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder={t('description_placeholder')}
                className={cn(
                  INPUT_BASE,
                  'resize-none',
                  errors.description ? INPUT_ERROR : INPUT_NORMAL,
                )}
              />
              {errors.description && (
                <p className="mt-1 text-xs text-error-500">{errors.description}</p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <Step2BudgetTimeline form={form} errors={errors} updateField={updateField} t={t} />
        )}

        {step === 2 && (
          <Step3Preferences
            form={form}
            updateField={updateField}
            skillInput={skillInput}
            setSkillInput={setSkillInput}
            addSkill={addSkill}
            removeSkill={removeSkill}
            t={t}
          />
        )}

        {step === 3 && <Step4Review form={form} t={t} />}
      </div>

      <div className="mt-6 flex items-center justify-between">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="flex items-center gap-1 rounded-lg border border-outline-dim/20 px-4 py-2.5 text-sm font-medium text-on-surface-muted hover:bg-surface-bright"
          >
            <ArrowLeft className="h-4 w-4" /> {tc('back')}
          </button>
        ) : (
          <Link
            to="/"
            className="flex items-center gap-1 text-sm text-on-surface-muted hover:text-brand-text"
          >
            <ArrowLeft className="h-4 w-4" /> {tc('home')}
          </Link>
        )}

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="flex items-center gap-1 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-primary-100 hover:bg-brand-hover"
          >
            {tc('next')} <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            className="flex items-center gap-1 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-primary-100 hover:bg-brand-hover"
          >
            <Check className="h-4 w-4" /> {t('submit')}
          </button>
        )}
      </div>

      {showLoginPrompt && (
        <Modal open onClose={() => setShowLoginPrompt(false)} title={t('login_to_submit')}>
          <div className="text-center">
            <Lock className="mx-auto h-10 w-10 text-brand-accent" />
            <p className="mt-2 text-sm text-on-surface-muted">{t('login_to_submit_desc')}</p>
            <div className="mt-6 flex flex-col gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-primary-100 hover:bg-brand-hover"
              >
                {tc('register')}
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-outline-dim/20 px-6 py-2.5 text-sm font-medium text-on-surface-muted hover:bg-surface-high"
              >
                {tc('login')}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setShowLoginPrompt(false)}
              className="mt-4 text-xs text-on-surface-muted hover:text-on-surface"
            >
              {tc('back')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
