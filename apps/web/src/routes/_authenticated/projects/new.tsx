import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  ClipboardList,
  FileCheck,
  FileText,
  Loader2,
  Settings,
  Sparkles,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCreateProject } from '@/hooks/use-projects'
import { useUploadPresignedUrl } from '@/hooks/use-talent'
import { cn, formatCurrency } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/new')({
  component: NewProjectPage,
})

type SelectedPath = null | 'A' | 'B'

const STEPS = [
  { key: 'basic_info', icon: FileText },
  { key: 'budget_timeline', icon: Wallet },
  { key: 'preferences', icon: Settings },
  { key: 'review_submit', icon: ClipboardList },
] as const

const CATEGORIES = ['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other'] as const

type DocumentType = '' | 'brd' | 'prd' | 'both'

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
  documentFileKey: string
  documentType: DocumentType
}

type BriefFormData = {
  title: string
  industry: string
  problem: string
  targetUsers: string
  mainFeatures: string
  budgetRange: string
  deadlineRange: string
  platforms: string[]
}

const BUDGET_RANGES = [
  'budget_not_decided',
  'budget_under_20m',
  'budget_20_50m',
  'budget_50_150m',
  'budget_over_150m',
] as const

const DEADLINE_RANGES = [
  'deadline_flexible',
  'deadline_1_2_months',
  'deadline_2_4_months',
  'deadline_4_6_months',
  'deadline_over_6_months',
] as const

const PLATFORM_OPTIONS = [
  'Web App',
  'Mobile (iOS)',
  'Mobile (Android)',
  'Desktop',
  'API / Backend',
] as const

const step1Schema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  category: z.enum(['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other']),
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
  'w-full rounded-lg border bg-surface-container px-3 py-2.5 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 transition-colors'
const INPUT_NORMAL = 'border-outline-dim/30 focus:border-primary-500 focus:ring-primary-500/30'
const INPUT_ERROR = 'border-error-500 focus:border-error-500 focus:ring-error-500'

function loadDraftFromStorage(): Partial<FormData> {
  try {
    const raw = localStorage.getItem('kerjacus-draft-project')
    if (!raw) return {}
    const data = JSON.parse(raw)
    localStorage.removeItem('kerjacus-draft-project')
    return {
      title: data.title ?? '',
      description: data.description ?? '',
      category: data.category ?? '',
      budgetMin: data.budgetMin ?? '',
      budgetMax: data.budgetMax ?? '',
      estimatedTimelineDays: data.timeline ?? '',
      almamater: data.almamater ?? '',
      minExperience: data.minExp ?? '',
      requiredSkills: data.skills ?? [],
      ...(data.visibility ? { visibility: data.visibility } : {}),
    }
  } catch {
    return {}
  }
}

function NewProjectPage() {
  const { t } = useTranslation('project')
  const navigate = useNavigate()
  const createProject = useCreateProject()

  const draft = loadDraftFromStorage()
  const hasDraft = !!(draft.title || draft.description)

  const [selectedPath, setSelectedPath] = useState<SelectedPath>(hasDraft ? 'A' : null)
  const [currentStep, setCurrentStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [projectType, setProjectType] = useState<'individual' | 'company'>('individual')
  const [companyName, setCompanyName] = useState('')
  const [companyRole, setCompanyRole] = useState('')
  const [form, setForm] = useState<FormData>({
    title: draft.title ?? '',
    description: draft.description ?? '',
    category: draft.category ?? '',
    budgetMin: draft.budgetMin ?? '',
    budgetMax: draft.budgetMax ?? '',
    estimatedTimelineDays: draft.estimatedTimelineDays ?? '',
    deadline: '',
    almamater: draft.almamater ?? '',
    minExperience: draft.minExperience ?? '',
    requiredSkills: draft.requiredSkills ?? [],
    documentFileKey: '',
    documentType: '',
  })
  const [skillInput, setSkillInput] = useState('')

  const [briefForm, setBriefForm] = useState<BriefFormData>({
    title: '',
    industry: '',
    problem: '',
    targetUsers: '',
    mainFeatures: '',
    budgetRange: '',
    deadlineRange: '',
    platforms: [],
  })
  const [briefErrors, setBriefErrors] = useState<Record<string, string>>({})

  const updateField = useCallback((field: keyof FormData, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const updateBriefField = useCallback((field: keyof BriefFormData, value: string | string[]) => {
    setBriefForm((prev) => ({ ...prev, [field]: value }))
    setBriefErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  function togglePlatform(platform: string) {
    setBriefForm((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform],
    }))
  }

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
              form.title.length === 0 ? t('validation_title_required') : t('validation_title_min')
          }
          if (field === 'description') {
            newErrors.description =
              form.description.length === 0
                ? t('validation_description_required')
                : t('validation_description_min')
          }
          if (field === 'category') {
            newErrors.category = t('validation_category_required')
          }
        }
      }
      // Path A requires document upload with type selection
      if (!form.documentFileKey) {
        newErrors.documentFileKey = t('validation_document_required')
      }
      if (!form.documentType) {
        newErrors.documentType = t('validation_document_type_required')
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
            newErrors.budgetMin = t('validation_budget_min_required')
          }
          if (field === 'budgetMax') {
            newErrors.budgetMax = t('validation_budget_max_required')
          }
          if (field === 'estimatedTimelineDays') {
            newErrors.estimatedTimelineDays = t('validation_timeline_required')
          }
        }
      }
      if (
        !newErrors.budgetMin &&
        !newErrors.budgetMax &&
        parseBudget(form.budgetMax) <= parseBudget(form.budgetMin)
      ) {
        newErrors.budgetMax = t('validation_budget_max_gt_min')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function validateBriefForm(): boolean {
    const newErrors: Record<string, string> = {}

    if (!briefForm.title.trim()) {
      newErrors.title = t('validation_title_required')
    }
    if (!briefForm.problem.trim()) {
      newErrors.problem = t('validation_brief_problem_required')
    }
    if (!briefForm.targetUsers.trim()) {
      newErrors.targetUsers = t('validation_brief_target_required')
    }
    if (!briefForm.mainFeatures.trim()) {
      newErrors.mainFeatures = t('validation_brief_features_required')
    }

    setBriefErrors(newErrors)
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
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        category: form.category,
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
      }
      if (form.documentFileKey) {
        payload.documentFileUrl = form.documentFileKey
        payload.documentType = form.documentType
      }
      const project = await createProject.mutateAsync(
        payload as Parameters<typeof createProject.mutateAsync>[0],
      )

      if (project?.id) {
        useToastStore.getState().addToast('success', t('project_created'))
        navigate({
          to: '/projects/$projectId/scoping',
          params: { projectId: project.id },
        })
      }
    } catch {
      setErrors({ submit: t('submit_error') })
    }
  }

  async function handleBriefSubmit() {
    if (!validateBriefForm()) return

    try {
      const budgetMap: Record<string, [number, number]> = {
        budget_under_20m: [0, 20000000],
        budget_20_50m: [20000000, 50000000],
        budget_50_150m: [50000000, 150000000],
        budget_over_150m: [150000000, 500000000],
      }
      const deadlineMap: Record<string, number> = {
        deadline_1_2_months: 45,
        deadline_2_4_months: 90,
        deadline_4_6_months: 150,
        deadline_over_6_months: 210,
      }
      const [bMin, bMax] = budgetMap[briefForm.budgetRange] ?? [0, 0]
      const days = deadlineMap[briefForm.deadlineRange] ?? 60
      const result = await createProject.mutateAsync({
        title: briefForm.title,
        description: `${briefForm.problem}\n\nTarget pengguna: ${briefForm.targetUsers}\n\nFitur utama: ${briefForm.mainFeatures}`,
        category: 'web_app' as const,
        budgetMin: bMin,
        budgetMax: bMax,
        estimatedTimelineDays: days,
        preferences: {
          industry: briefForm.industry,
          problem: briefForm.problem,
          targetUsers: briefForm.targetUsers,
          mainFeatures: briefForm.mainFeatures,
          budgetRange: briefForm.budgetRange,
          deadlineRange: briefForm.deadlineRange,
          platforms: briefForm.platforms,
        },
      })
      const projectId = (result as Record<string, unknown>)?.id as string
      if (projectId) {
        navigate({ to: '/projects/$projectId/scoping', params: { projectId } })
      }
    } catch {
      useToastStore.getState().addToast('error', t('submit_error'))
    }
  }

  function handleBackToChooser() {
    setSelectedPath(null)
    setCurrentStep(0)
    setErrors({})
    setBriefErrors({})
  }

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary-600">{t('new_project')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          {selectedPath === null ? t('path_chooser_subtitle') : t('new_project_subtitle')}
        </p>
      </div>

      {/* Step 0: Path Chooser */}
      {selectedPath === null && <PathChooser onSelect={setSelectedPath} />}

      {/* Path A: Full 4-step form */}
      {selectedPath === 'A' && (
        <PathAForm
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
          form={form}
          errors={errors}
          updateField={updateField}
          skillInput={skillInput}
          setSkillInput={setSkillInput}
          addSkill={addSkill}
          removeSkill={removeSkill}
          handleNext={handleNext}
          handleBack={handleBack}
          handleSubmit={handleSubmit}
          handleBackToChooser={handleBackToChooser}
          createProject={createProject}
          projectType={projectType}
          setProjectType={setProjectType}
          companyName={companyName}
          setCompanyName={setCompanyName}
          companyRole={companyRole}
          setCompanyRole={setCompanyRole}
        />
      )}

      {/* Path B: Brief template for AI */}
      {selectedPath === 'B' && (
        <PathBForm
          briefForm={briefForm}
          briefErrors={briefErrors}
          updateBriefField={updateBriefField}
          togglePlatform={togglePlatform}
          handleBriefSubmit={handleBriefSubmit}
          handleBackToChooser={handleBackToChooser}
        />
      )}
    </div>
  )
}

/* ── Path Chooser ── */

function PathChooser({ onSelect }: { onSelect: (path: SelectedPath) => void }) {
  const { t } = useTranslation('project')

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {/* Path A: Already have specs */}
      <button
        type="button"
        onClick={() => onSelect('A')}
        className="group rounded-3xl border-2 border-outline-dim/20 bg-surface-bright p-7 text-left transition-all hover:border-primary-500/30 hover:bg-primary-500/5"
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/10 transition-transform group-hover:scale-110">
          <FileCheck className="h-6 w-6 text-primary-600" />
        </div>
        <h4 className="mb-2 text-base font-extrabold text-on-surface">{t('path_a_title')}</h4>
        <p className="text-xs leading-relaxed text-on-surface-muted">{t('path_a_description')}</p>
        <div className="mt-5 flex items-center gap-1.5 text-xs font-bold text-primary-600">
          {t('path_a_action')}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </div>
      </button>

      {/* Path B: No specs yet — AI helps */}
      <button
        type="button"
        onClick={() => onSelect('B')}
        className="group relative overflow-hidden rounded-3xl border-2 border-transparent bg-primary-600 p-7 text-left shadow-xl transition-all hover:opacity-95"
      >
        <div className="pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-accent-coral-500/20 blur-2xl" />
        <div className="relative z-10">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 transition-transform group-hover:scale-110">
            <Sparkles className="h-6 w-6 text-accent-coral-500" />
          </div>
          <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-accent-coral-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">
            {t('path_b_badge')}
          </div>
          <h4 className="mb-2 text-base font-extrabold text-white">{t('path_b_title')}</h4>
          <p className="text-xs leading-relaxed text-white/70">{t('path_b_description')}</p>
          <div className="mt-5 flex items-center gap-1.5 text-xs font-bold text-primary-100">
            {t('path_b_action')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </button>
    </div>
  )
}

/* ── Path A: 4-step project form ── */

function PathAForm({
  currentStep,
  setCurrentStep,
  form,
  errors,
  updateField,
  skillInput,
  setSkillInput,
  addSkill,
  removeSkill,
  handleNext,
  handleBack,
  handleSubmit,
  handleBackToChooser,
  createProject,
  projectType,
  setProjectType,
  companyName,
  setCompanyName,
  companyRole,
  setCompanyRole,
}: {
  currentStep: number
  setCurrentStep: (step: number) => void
  form: FormData
  errors: Record<string, string>
  updateField: (field: keyof FormData, value: string | string[]) => void
  skillInput: string
  setSkillInput: (v: string) => void
  addSkill: (skill: string) => void
  removeSkill: (skill: string) => void
  handleNext: () => void
  handleBack: () => void
  handleSubmit: () => void
  handleBackToChooser: () => void
  createProject: ReturnType<typeof useCreateProject>
  projectType: 'individual' | 'company'
  setProjectType: (v: 'individual' | 'company') => void
  companyName: string
  setCompanyName: (v: string) => void
  companyRole: string
  setCompanyRole: (v: string) => void
}) {
  const { t } = useTranslation('project')

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
          <h3 className="text-xl font-extrabold text-primary-600">{t('path_a_form_title')}</h3>
          <p className="mt-0.5 text-xs text-on-surface-muted">{t('path_a_form_subtitle')}</p>
        </div>
      </div>

      <StepIndicator currentStep={currentStep} onStepClick={(step) => setCurrentStep(step)} />

      <div className="mt-8 rounded-xl border border-outline-dim/20 bg-surface-bright p-6 lg:p-8">
        {currentStep === 0 && (
          <Step1BasicInfo
            form={form}
            errors={errors}
            updateField={updateField}
            t={t}
            projectType={projectType}
            setProjectType={setProjectType}
            companyName={companyName}
            setCompanyName={setCompanyName}
            companyRole={companyRole}
            setCompanyRole={setCompanyRole}
            onDocumentUploaded={(key) => updateField('documentFileKey', key)}
          />
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

        <div className="mt-8 flex items-center justify-between border-t border-outline-dim/20 pt-6">
          {currentStep > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 bg-transparent px-4 py-2.5 text-sm font-medium text-on-surface-muted transition-colors hover:border-neutral-400/50 hover:text-on-surface"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </button>
          ) : (
            <div />
          )}

          {currentStep < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90"
            >
              {t('next')}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createProject.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {createProject.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('submitting')}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {t('submit')}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Path B: Brief template form ── */

function PathBForm({
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
          <h3 className="text-xl font-extrabold text-primary-600">{title}</h3>
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
          className="inline-flex items-center gap-2 rounded-2xl bg-primary-600 px-8 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:opacity-90 hover:shadow-lg"
        >
          <Sparkles className="h-4 w-4" />
          {t('generate_brd_with_ai')}
        </button>
      </div>
    </div>
  )
}

/* ── Step Indicator ── */

function StepIndicator({
  currentStep,
  onStepClick,
}: {
  currentStep: number
  onStepClick?: (step: number) => void
}) {
  const { t } = useTranslation('project')

  return (
    <div className="flex items-center justify-between">
      {STEPS.map((step, index) => {
        const Icon = step.icon
        const isActive = index === currentStep
        const isCompleted = index < currentStep
        const isClickable = index <= currentStep

        return (
          <div key={step.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(index)}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
                  isCompleted && 'border-primary-600 bg-primary-600 text-white cursor-pointer',
                  isActive &&
                    'border-warning-500 bg-warning-500/10 text-primary-600 cursor-default',
                  !isActive &&
                    !isCompleted &&
                    'border-outline-dim/20 bg-surface-container text-on-surface-muted cursor-not-allowed opacity-50',
                )}
              >
                {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </button>
              <span
                className={cn(
                  'mt-2 text-xs font-medium',
                  isActive && 'text-primary-600',
                  isCompleted && 'text-primary-600',
                  !isActive && !isCompleted && 'text-on-surface-muted',
                )}
              >
                {t(step.key, step.key)}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-2 h-0.5 flex-1',
                  index < currentStep ? 'bg-success-600' : 'bg-outline-dim',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Step 1: Basic Info ── */

function Step1BasicInfo({
  form,
  errors,
  updateField,
  t,
  projectType,
  setProjectType,
  companyName,
  setCompanyName,
  companyRole,
  setCompanyRole,
  onDocumentUploaded,
}: {
  form: FormData
  errors: Record<string, string>
  updateField: (field: keyof FormData, value: string | string[]) => void
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
  projectType: 'individual' | 'company'
  setProjectType: (v: 'individual' | 'company') => void
  companyName: string
  setCompanyName: (v: string) => void
  companyRole: string
  setCompanyRole: (v: string) => void
  onDocumentUploaded: (key: string) => void
}) {
  const uploadPresigned = useUploadPresignedUrl()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [docFile, setDocFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const handleFileChange = (file: File | null) => {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx'].includes(ext ?? '')) {
      setUploadError(t('upload_invalid_type'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t('upload_file_too_large'))
      return
    }
    setUploadError('')
    setDocFile(file)
    handleUpload(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFileChange(e.dataTransfer.files[0] ?? null)
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadError('')
    try {
      const presigned = await uploadPresigned.mutateAsync({
        fileName: file.name,
        fileType: file.type,
        folder: 'document',
      })
      await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      onDocumentUploaded(presigned.key)
    } catch {
      setUploadError(t('upload_failed'))
      setDocFile(null)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-primary-600">{t('basic_info')}</h2>

      {/* Document type selector */}
      <div>
        <label htmlFor="doc-type" className="mb-2 block text-sm font-medium text-on-surface">
          {t('document_type')} <span className="text-error-500">*</span>
        </label>
        <div id="doc-type" className="grid grid-cols-3 gap-3">
          {(
            [
              { value: 'brd' as const, label: t('doc_type_brd') },
              { value: 'prd' as const, label: t('doc_type_prd') },
              { value: 'both' as const, label: t('doc_type_both') },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateField('documentType', opt.value)}
              className={`rounded-xl border-2 p-3 text-center text-sm font-semibold transition-all ${form.documentType === opt.value ? 'border-primary-500 bg-primary-500/5 text-primary-600' : 'border-outline-dim/20 text-on-surface-muted hover:border-outline-dim/40'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {errors.documentType && (
          <p className="mt-1 text-xs text-error-500">{errors.documentType}</p>
        )}
      </div>

      {/* Document upload (required) */}
      <div>
        <label htmlFor="doc-upload" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('upload_existing_document')}
          <span className="text-error-500"> *</span>
        </label>
        <input
          id="doc-upload"
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
        {form.documentFileKey && docFile ? (
          <div className="flex items-center gap-3 rounded-lg border border-success-500/30 bg-success-500/5 px-4 py-3">
            <CheckCircle className="h-5 w-5 shrink-0 text-success-600" />
            <span className="flex-1 truncate text-sm text-on-surface">{docFile.name}</span>
            <button
              type="button"
              onClick={() => {
                setDocFile(null)
                onDocumentUploaded('')
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="text-on-surface-muted hover:text-error-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            disabled={uploading}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
              errors.documentFileKey
                ? 'border-error-500/50 bg-error-500/5'
                : 'border-outline-dim/30 bg-surface-container hover:border-primary-500/40 hover:bg-primary-500/5',
            )}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            ) : (
              <Upload className="h-6 w-6 text-on-surface-muted" />
            )}
            <span className="text-sm text-on-surface-muted">
              {uploading ? t('uploading') : t('drag_drop_document')}
            </span>
            <span className="text-xs text-outline">PDF, DOCX</span>
          </button>
        )}
        {uploadError && <p className="mt-1 text-xs text-error-500">{uploadError}</p>}
        {!uploadError && errors.documentFileKey && (
          <p className="mt-1 text-xs text-error-500">{errors.documentFileKey}</p>
        )}
      </div>

      {/* Individual or Company */}
      <div>
        <label htmlFor="project-type" className="mb-2 block text-sm font-medium text-on-surface">
          {t('project_type')}
        </label>
        <div id="project-type" className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setProjectType('individual')}
            className={`rounded-xl border-2 p-3 text-center text-sm font-semibold transition-all ${projectType === 'individual' ? 'border-primary-500 bg-primary-500/5 text-primary-600' : 'border-outline-dim/20 text-on-surface-muted hover:border-outline-dim/40'}`}
          >
            {t('type_individual')}
          </button>
          <button
            type="button"
            onClick={() => setProjectType('company')}
            className={`rounded-xl border-2 p-3 text-center text-sm font-semibold transition-all ${projectType === 'company' ? 'border-primary-500 bg-primary-500/5 text-primary-600' : 'border-outline-dim/20 text-on-surface-muted hover:border-outline-dim/40'}`}
          >
            {t('type_company')}
          </button>
        </div>
      </div>

      {projectType === 'company' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="company-name"
              className="mb-1.5 block text-sm font-medium text-on-surface"
            >
              {t('company_name')}
            </label>
            <input
              id="company-name"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t('company_name_placeholder')}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            />
          </div>
          <div>
            <label
              htmlFor="company-role"
              className="mb-1.5 block text-sm font-medium text-on-surface"
            >
              {t('company_role')}
            </label>
            <input
              id="company-role"
              type="text"
              value={companyRole}
              onChange={(e) => setCompanyRole(e.target.value)}
              placeholder={t('company_role_placeholder')}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            />
          </div>
        </div>
      )}

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

/* ── Step 2: Budget & Timeline ── */

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
        <h2 className="text-lg font-semibold text-primary-600">{t('preferences')}</h2>
        <p className="mt-1 text-sm text-on-surface-muted">{t('preferences_optional')}</p>
      </div>

      <div>
        <label htmlFor="almamater" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('almamater')}
        </label>
        <input
          id="almamater"
          type="text"
          value={form.almamater}
          onChange={(e) => updateField('almamater', e.target.value)}
          placeholder={t('almamater_placeholder')}
          className={cn(INPUT_BASE, INPUT_NORMAL)}
        />
      </div>

      <div>
        <label htmlFor="minExperience" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('min_experience')}
        </label>
        <input
          id="minExperience"
          type="number"
          min="0"
          value={form.minExperience}
          onChange={(e) => updateField('minExperience', e.target.value)}
          placeholder={t('min_experience_placeholder')}
          className={cn(INPUT_BASE, INPUT_NORMAL)}
        />
      </div>

      <div>
        <label htmlFor="skillInput" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('required_skills')}
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
            placeholder={t('required_skills_placeholder')}
            className={cn(INPUT_BASE, INPUT_NORMAL, 'flex-1')}
          />
          <button
            type="button"
            onClick={() => addSkill(skillInput)}
            disabled={!skillInput.trim()}
            className="rounded-lg bg-surface-container px-4 py-2.5 text-sm font-semibold text-on-surface-muted transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40"
          >
            +
          </button>
        </div>
        {form.requiredSkills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {form.requiredSkills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-3 py-1 text-xs font-medium text-primary-600"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-primary-500/10"
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

/* ── Step 4: Review ── */

function Step4Review({
  form,
  t,
}: {
  form: FormData
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-primary-600">{t('review_submit')}</h2>

      <div className="rounded-lg border border-outline-dim/20 bg-surface-container p-5">
        <h3 className="mb-4 text-sm font-semibold text-primary-600/80">
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
        <h3 className="mb-4 text-sm font-semibold text-primary-600/80">
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
        <h3 className="mb-4 text-sm font-semibold text-primary-600/80">
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
                      className="rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-medium text-primary-600"
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
      <dt className="w-40 shrink-0 text-xs text-on-surface-muted">{label}</dt>
      <dd className={cn('text-sm text-on-surface', multiline && 'whitespace-pre-wrap')}>{value}</dd>
    </div>
  )
}
