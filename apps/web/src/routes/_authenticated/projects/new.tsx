import { ProjectVisibility } from '@kerjacus/shared'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PathAForm } from '@/components/project/new/path-a-form'
import { PathBForm } from '@/components/project/new/path-b-form'
import { PathChooser } from '@/components/project/new/path-chooser'
import {
  type BriefFormData,
  buildCreateProjectPayload,
  type FormData,
  parseBudget,
  type SelectedPath,
  STEPS,
  step1Schema,
  step2Schema,
} from '@/components/project/new/shared'
import { useCreateProject } from '@/hooks/use-projects'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/new')({
  component: NewProjectPage,
})

// The wizard's pieces live in components/project/new. This module is the
// orchestration: which path the owner took, which step they are on, and
// what gets submitted.

// Re-exported: the payload builder moved to shared, and its test imports it
// from here.
export { buildCreateProjectPayload } from '@/components/project/new/shared'

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
      // Draft is untrusted JSON, keep known values only.
      ...(Object.values(ProjectVisibility).includes(data.visibility)
        ? { visibility: data.visibility as ProjectVisibility }
        : {}),
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
    visibility: draft.visibility ?? ProjectVisibility.PUBLIC_SUMMARY,
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

    try {
      const payload = buildCreateProjectPayload(form, { projectType, companyName, companyRole })
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
