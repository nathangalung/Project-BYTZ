import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { STEPS } from './shared'

export function StepIndicator({
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
