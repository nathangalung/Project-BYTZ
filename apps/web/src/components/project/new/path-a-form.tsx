import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { useCreateProject } from '@/hooks/use-projects'
import { type FormData, STEPS } from './shared'
import { Step1BasicInfo } from './step-basic-info'
import { Step2BudgetTimeline } from './step-budget-timeline'
import { StepIndicator } from './step-indicator'
import { Step3Preferences } from './step-preferences'
import { Step4Review } from './step-review'

export function PathAForm({
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
          <h3 className="text-xl font-extrabold text-brand-text">{t('path_a_form_title')}</h3>
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
              className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 bg-transparent px-4 py-2.5 text-sm font-medium text-on-surface-muted transition-colors hover:border-outline-dim/30 hover:text-on-surface"
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
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90"
            >
              {t('next')}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createProject.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
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
