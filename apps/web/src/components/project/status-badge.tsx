import { useTranslation } from 'react-i18next'
import {
  PROJECT_CONDITION_BADGE,
  type ProjectConditionSource,
  projectConditionLabelKey,
  projectConditions,
  projectStatusBadge,
  projectStatusLabel,
} from '@/lib/project-status'
import { cn } from '@/lib/utils'

type Props = {
  status: string
  /** The row the conditions are read from; omit where none can apply. */
  project?: ProjectConditionSource | null
  className?: string
}

/**
 * Where a project is, and what is true about it right now.
 *
 * One badge used to say both, and saying both in one word meant losing one of
 * them: a disputed project read "Disengketakan" and nothing at all about
 * whether the work was half done or waiting to be signed off. The position
 * always renders; a live dispute or a hold renders beside it, so the same
 * project reads "Dalam Proses - Sengketa".
 */
export function ProjectStatusBadge({ status, project, className }: Props) {
  const { t } = useTranslation('project')
  const conditions = projectConditions(project)

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <span
        className={cn(
          'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
          projectStatusBadge(status),
        )}
      >
        {projectStatusLabel(t, status)}
      </span>
      {conditions.map((condition) => (
        <span
          key={condition}
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            PROJECT_CONDITION_BADGE[condition],
          )}
        >
          {t(projectConditionLabelKey(condition))}
        </span>
      ))}
    </span>
  )
}
