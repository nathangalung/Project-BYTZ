import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  FileText,
  Loader2,
  Settings,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCreateProject } from '@/hooks/use-projects'
import { cn, formatCurrency } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/new')({
  component: NewProjectPage,
})

const STEPS = [
  { key: 'basic_info', icon: FileText },
  { key: 'budget_timeline', icon: Wallet },
  { key: 'preferences', icon: Settings },
  { key: 'review_submit', icon: ClipboardList },
] as const

const CATEGORIES = ['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital'] as const

type FormData = {
  title: string
  description: string
  category: string
  budgetMin: string
  budgetMax: string
  estimatedTimelineDays: string
  deadline: string
  almamater: string
  minExperience: string
  requiredSkills: string[]
}

const step1Schema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  category: z.enum(['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital']),
})

const step2Schema = z.object({
  budgetMin: z
    .string()
    .min(1)
    .refine((v) => Number(v.replace(/\D/g, '')) > 0, {
      message: 'Budget minimum must be positive',
    }),
  budgetMax: z
    .string()
    .min(1)
    .refine((v) => Number(v.replace(/\D/g, '')) > 0, {
      message: 'Budget maximum must be positive',
    }),
  estimatedTimelineDays: z
    .string()
    .min(1)
    .refine((v) => Number(v) > 0, {
      message: 'Timeline must be positive',
    }),
})

function parseBudget(raw: string): number {
  return Number(raw.replace(/\D/g, '')) || 0
}

function formatBudgetInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('id-ID')
}

const INPUT_BASE =
  'w-full rounded-lg border bg-primary-700 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 transition-colors'
const INPUT_NORMAL = 'border-primary-500/30 focus:border-success-500 focus:ring-success-500'
const INPUT_ERROR = 'border-error-500 focus:border-error-500 focus:ring-error-500'

function NewProjectPage() {
  const { t } = useTranslation('project')
  const navigate = useNavigate()
  const createProject = useCreateProject()

  const [currentStep, setCurrentStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
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
  })
  const [skillInput, setSkillInput] = useState('')

  const updateField = useCallback((field: keyof FormData, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  function validateStep(step: number): boolean {
    const newErrors: Record<string, string> = {}

    if (step === 0) {
      const result = step1Schema.safeParse({
        title: form.title,
        description: form.description,
        category: form.category,
      })
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string
          if (field === 'title') {
            newErrors.title =
              form.title.length === 0
                ? t('validation_title_required', 'Judul proyek wajib diisi')
                : t('validation_title_min', 'Judul minimal 3 karakter')
          }
          if (field === 'description') {
            newErrors.description =
              form.description.length === 0
                ? t('validation_description_required', 'Deskripsi wajib diisi')
                : t('validation_description_min', 'Deskripsi minimal 10 karakter')
          }
          if (field === 'category') {
            newErrors.category = t('validation_category_required', 'Pilih kategori')
          }
        }
      }
    }

    if (step === 1) {
      const result = step2Schema.safeParse({
        budgetMin: form.budgetMin,
        budgetMax: form.budgetMax,
        estimatedTimelineDays: form.estimatedTimelineDays,
      })
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string
          if (field === 'budgetMin') {
            newErrors.budgetMin = t('validation_budget_min_required', 'Budget minimum wajib diisi')
          }
          if (field === 'budgetMax') {
            newErrors.budgetMax = t('validation_budget_max_required', 'Budget maksimum wajib diisi')
          }
          if (field === 'estimatedTimelineDays') {
            newErrors.estimatedTimelineDays = t(
              'validation_timeline_required',
              'Timeline wajib diisi',
            )
          }
        }
      }
      if (
        !newErrors.budgetMin &&
        !newErrors.budgetMax &&
        parseBudget(form.budgetMax) <= parseBudget(form.budgetMin)
      ) {
        newErrors.budgetMax = t('validation_budget_max_gt_min', 'Budget maksimum harus lebih besar')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleNext() {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1))
    }
  }

  function handleBack() {
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }

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

  async function handleSubmit() {
    if (!validateStep(0) || !validateStep(1)) return

    const preferences: Record<string, unknown> = {}
    if (form.almamater) preferences.almamater = form.almamater
    if (form.minExperience) preferences.minExperience = Number(form.minExperience)
    if (form.requiredSkills.length > 0) preferences.requiredSkills = form.requiredSkills

    try {
      const project = await createProject.mutateAsync({
        title: form.title,
        description: form.description,
        category: form.category as
          | 'web_app'
          | 'mobile_app'
          | 'ui_ux_design'
          | 'data_ai'
          | 'other_digital',
        budgetMin: parseBudget(form.budgetMin),
        budgetMax: parseBudget(form.budgetMax),
        estimatedTimelineDays: Number(form.estimatedTimelineDays),
        preferences:
          Object.keys(preferences).length > 0
            ? (preferences as {
                almamater?: string
                minExperience?: number
                requiredSkills?: string[]
              })
            : undefined,
      })

      if (project?.id) {
        useToastStore.getState().addToast('success', 'Proyek berhasil dibuat!')
        navigate({
          to: '/projects/$projectId/scoping',
          params: { projectId: project.id },
        })
      }
    } catch {
      setErrors({ submit: t('submit_error', 'Gagal membuat proyek. Silakan coba lagi.') })
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-warning-500">{t('new_project', 'Proyek Baru')}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('new_project_subtitle', 'Isi detail proyek Anda untuk memulai')}
        </p>
      </div>

      <StepIndicator currentStep={currentStep} />

      <div className="mt-8 rounded-xl border border-neutral-700/30 bg-neutral-600 p-6 lg:p-8">
        {currentStep === 0 && (
          <Step1BasicInfo form={form} errors={errors} updateField={updateField} t={t} />
        )}
        {currentStep === 1 && (
          <Step2BudgetTimeline form={form} errors={errors} updateField={updateField} t={t} />
        )}
        {currentStep === 2 && (
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
        {currentStep === 3 && <Step4Review form={form} t={t} />}

        {errors.submit && <p className="mt-4 text-sm text-error-500">{errors.submit}</p>}

        <div className="mt-8 flex items-center justify-between border-t border-primary-500/20 pt-6">
          {currentStep > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-500/30 bg-transparent px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-400/50 hover:text-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('back', 'Kembali')}
            </button>
          ) : (
            <div />
          )}

          {currentStep < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-900 shadow-sm transition-colors hover:bg-success-600"
            >
              {t('next', 'Lanjut')}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createProject.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-900 shadow-sm transition-colors hover:bg-success-600 disabled:opacity-50"
            >
              {createProject.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('submitting', 'Mengirim...')}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {t('submit', 'Kirim Proyek')}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  const { t } = useTranslation('project')

  return (
    <div className="flex items-center justify-between">
      {STEPS.map((step, index) => {
        const Icon = step.icon
        const isActive = index === currentStep
        const isCompleted = index < currentStep

        return (
          <div key={step.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
                  isCompleted && 'border-success-500 bg-success-500 text-primary-900',
                  isActive && 'border-warning-500 bg-warning-500/10 text-warning-500',
                  !isActive &&
                    !isCompleted &&
                    'border-neutral-500/30 bg-primary-700 text-neutral-500',
                )}
              >
                {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </div>
              <span
                className={cn(
                  'mt-2 text-xs font-medium',
                  isActive && 'text-warning-500',
                  isCompleted && 'text-success-500',
                  !isActive && !isCompleted && 'text-neutral-500',
                )}
              >
                {t(step.key, step.key)}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-2 h-0.5 flex-1',
                  index < currentStep ? 'bg-success-500' : 'bg-neutral-700',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Step1BasicInfo({
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
      <h2 className="text-lg font-semibold text-warning-500">
        {t('basic_info', 'Informasi Dasar')}
      </h2>

      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-neutral-200">
          {t('title', 'Judul Proyek')} <span className="text-error-500">*</span>
        </label>
        <input
          id="title"
          type="text"
          value={form.title}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder={t('title_placeholder', 'Masukkan judul proyek')}
          className={cn(INPUT_BASE, errors.title ? INPUT_ERROR : INPUT_NORMAL)}
        />
        {errors.title && <p className="mt-1 text-xs text-error-500">{errors.title}</p>}
      </div>

      <div>
        <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-neutral-200">
          {t('category', 'Kategori')} <span className="text-error-500">*</span>
        </label>
        <select
          id="category"
          value={form.category}
          onChange={(e) => updateField('category', e.target.value)}
          className={cn(
            INPUT_BASE,
            !form.category && 'text-neutral-500',
            errors.category ? INPUT_ERROR : INPUT_NORMAL,
          )}
        >
          <option value="" disabled>
            {t('category_placeholder', 'Pilih kategori proyek')}
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
        <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-neutral-200">
          {t('description', 'Deskripsi')} <span className="text-error-500">*</span>
        </label>
        <textarea
          id="description"
          rows={5}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
          placeholder={t('description_placeholder', 'Jelaskan kebutuhan proyek Anda secara detail')}
          className={cn(INPUT_BASE, 'resize-none', errors.description ? INPUT_ERROR : INPUT_NORMAL)}
        />
        {errors.description && <p className="mt-1 text-xs text-error-500">{errors.description}</p>}
      </div>
    </div>
  )
}

function Step2BudgetTimeline({
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
      <h2 className="text-lg font-semibold text-warning-500">
        {t('budget_timeline', 'Budget & Timeline')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="budgetMin" className="mb-1.5 block text-sm font-medium text-neutral-200">
            {t('budget_min', 'Budget Minimum')} <span className="text-error-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
              Rp
            </span>
            <input
              id="budgetMin"
              type="text"
              inputMode="numeric"
              value={formatBudgetInput(form.budgetMin)}
              onChange={(e) => updateField('budgetMin', e.target.value.replace(/\D/g, ''))}
              placeholder={t('budget_min_placeholder', '0')}
              className={cn(INPUT_BASE, 'pl-9', errors.budgetMin ? INPUT_ERROR : INPUT_NORMAL)}
            />
          </div>
          {errors.budgetMin && <p className="mt-1 text-xs text-error-500">{errors.budgetMin}</p>}
        </div>

        <div>
          <label htmlFor="budgetMax" className="mb-1.5 block text-sm font-medium text-neutral-200">
            {t('budget_max', 'Budget Maksimum')} <span className="text-error-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
              Rp
            </span>
            <input
              id="budgetMax"
              type="text"
              inputMode="numeric"
              value={formatBudgetInput(form.budgetMax)}
              onChange={(e) => updateField('budgetMax', e.target.value.replace(/\D/g, ''))}
              placeholder={t('budget_max_placeholder', '0')}
              className={cn(INPUT_BASE, 'pl-9', errors.budgetMax ? INPUT_ERROR : INPUT_NORMAL)}
            />
          </div>
          {errors.budgetMax && <p className="mt-1 text-xs text-error-500">{errors.budgetMax}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="timeline" className="mb-1.5 block text-sm font-medium text-neutral-200">
            {t('timeline', 'Estimasi Timeline (hari)')} <span className="text-error-500">*</span>
          </label>
          <input
            id="timeline"
            type="number"
            min="1"
            value={form.estimatedTimelineDays}
            onChange={(e) => updateField('estimatedTimelineDays', e.target.value)}
            placeholder={t('timeline_placeholder', '60')}
            className={cn(INPUT_BASE, errors.estimatedTimelineDays ? INPUT_ERROR : INPUT_NORMAL)}
          />
          {errors.estimatedTimelineDays && (
            <p className="mt-1 text-xs text-error-500">{errors.estimatedTimelineDays}</p>
          )}
        </div>

        <div>
          <label htmlFor="deadline" className="mb-1.5 block text-sm font-medium text-neutral-200">
            {t('deadline', 'Deadline')}
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

function Step3Preferences({
  form,
  updateField,
  skillInput,
  setSkillInput,
  addSkill,
  removeSkill,
  t,
}: {
  form: FormData
  updateField: (field: keyof FormData, value: string | string[]) => void
  skillInput: string
  setSkillInput: (v: string) => void
  addSkill: (skill: string) => void
  removeSkill: (skill: string) => void
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-warning-500">
          {t('preferences', 'Preferensi Worker')}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('preferences_optional', 'Semua field di bawah ini opsional')}
        </p>
      </div>

      <div>
        <label htmlFor="almamater" className="mb-1.5 block text-sm font-medium text-neutral-200">
          {t('almamater', 'Almamater')}
        </label>
        <input
          id="almamater"
          type="text"
          value={form.almamater}
          onChange={(e) => updateField('almamater', e.target.value)}
          placeholder={t('almamater_placeholder', 'Contoh: Universitas Indonesia')}
          className={cn(INPUT_BASE, INPUT_NORMAL)}
        />
      </div>

      <div>
        <label
          htmlFor="minExperience"
          className="mb-1.5 block text-sm font-medium text-neutral-200"
        >
          {t('min_experience', 'Pengalaman Minimum (tahun)')}
        </label>
        <input
          id="minExperience"
          type="number"
          min="0"
          value={form.minExperience}
          onChange={(e) => updateField('minExperience', e.target.value)}
          placeholder={t('min_experience_placeholder', '0')}
          className={cn(INPUT_BASE, INPUT_NORMAL)}
        />
      </div>

      <div>
        <label htmlFor="skillInput" className="mb-1.5 block text-sm font-medium text-neutral-200">
          {t('required_skills', 'Skill yang Dibutuhkan')}
        </label>
        <div className="flex gap-2">
          <input
            id="skillInput"
            type="text"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSkill(skillInput)
              }
            }}
            placeholder={t('required_skills_placeholder', 'Ketik skill dan tekan Enter')}
            className={cn(INPUT_BASE, INPUT_NORMAL, 'flex-1')}
          />
          <button
            type="button"
            onClick={() => addSkill(skillInput)}
            disabled={!skillInput.trim()}
            className="rounded-lg bg-primary-700 px-4 py-2.5 text-sm font-semibold text-neutral-300 transition-colors hover:bg-primary-800 hover:text-neutral-100 disabled:opacity-40"
          >
            +
          </button>
        </div>
        {form.requiredSkills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {form.requiredSkills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-3 py-1 text-xs font-medium text-success-500"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-success-500/20"
                  aria-label={`Remove ${skill}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Step4Review({
  form,
  t,
}: {
  form: FormData
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-warning-500">
        {t('review_submit', 'Review & Kirim')}
      </h2>

      <div className="rounded-lg border border-primary-500/20 bg-primary-700/40 p-5">
        <h3 className="mb-4 text-sm font-semibold text-warning-500/80">
          {t('review_section_basic', 'Informasi Dasar')}
        </h3>
        <dl className="space-y-3">
          <ReviewItem label={t('title', 'Judul')} value={form.title} />
          <ReviewItem label={t('category', 'Kategori')} value={t(form.category, form.category)} />
          <ReviewItem label={t('description', 'Deskripsi')} value={form.description} multiline />
        </dl>
      </div>

      <div className="rounded-lg border border-primary-500/20 bg-primary-700/40 p-5">
        <h3 className="mb-4 text-sm font-semibold text-warning-500/80">
          {t('review_section_budget', 'Budget & Timeline')}
        </h3>
        <dl className="space-y-3">
          <ReviewItem
            label={t('budget_min', 'Budget Min')}
            value={formatCurrency(parseBudget(form.budgetMin))}
          />
          <ReviewItem
            label={t('budget_max', 'Budget Max')}
            value={formatCurrency(parseBudget(form.budgetMax))}
          />
          <ReviewItem
            label={t('timeline', 'Timeline')}
            value={`${form.estimatedTimelineDays} ${t('days', 'hari')}`}
          />
          {form.deadline && <ReviewItem label={t('deadline', 'Deadline')} value={form.deadline} />}
        </dl>
      </div>

      <div className="rounded-lg border border-primary-500/20 bg-primary-700/40 p-5">
        <h3 className="mb-4 text-sm font-semibold text-warning-500/80">
          {t('review_section_preferences', 'Preferensi Worker')}
        </h3>
        <dl className="space-y-3">
          <ReviewItem
            label={t('almamater', 'Almamater')}
            value={form.almamater || t('not_specified', 'Tidak ditentukan')}
          />
          <ReviewItem
            label={t('min_experience', 'Pengalaman Min')}
            value={
              form.minExperience
                ? `${form.minExperience} ${t('years', 'tahun')}`
                : t('not_specified', 'Tidak ditentukan')
            }
          />
          <div className="flex items-start gap-3">
            <dt className="w-40 shrink-0 text-xs text-neutral-500">
              {t('required_skills', 'Skills')}
            </dt>
            <dd className="text-sm text-neutral-200">
              {form.requiredSkills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.requiredSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-success-500/15 px-2.5 py-0.5 text-xs font-medium text-success-500"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-neutral-500">{t('not_specified', 'Tidak ditentukan')}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function ReviewItem({
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
      <dt className="w-40 shrink-0 text-xs text-neutral-500">{label}</dt>
      <dd className={cn('text-sm text-neutral-200', multiline && 'whitespace-pre-wrap')}>
        {value}
      </dd>
    </div>
  )
}
