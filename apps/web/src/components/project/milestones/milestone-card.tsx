import { AlertTriangle, Calendar, ChevronRight, MessageSquare, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { ColumnId, MilestoneItem } from './shared'

export function MilestoneCard({
  milestone,
  onSelect,
  onStatusChange,
  isMutating,
  role,
}: {
  milestone: MilestoneItem
  onSelect: () => void
  onStatusChange: (id: string, status: ColumnId) => void | Promise<void>
  isMutating: boolean
  role?: string
}) {
  const { t } = useTranslation('project')

  const isOverdue =
    milestone.dueDate &&
    new Date(milestone.dueDate) < new Date() &&
    milestone.status !== 'approved' &&
    milestone.status !== 'rejected'

  return (
    <div
      className={cn(
        'group cursor-pointer rounded-lg border p-3 transition-all hover:border-brand-accent/30',
        isOverdue
          ? 'bg-surface-bright border-accent-coral-500/30'
          : 'bg-surface-bright border-outline-dim/10',
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-brand-text">{milestone.title}</h4>
          {milestone.milestoneType === 'integration' && (
            <span className="shrink-0 rounded bg-accent-coral-500/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-coral-600">
              {t('integration')}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-1 line-clamp-2 text-xs text-on-surface-muted">{milestone.description}</p>

        {/* Meta row */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {milestone.assignedWorkerLabel && (
              <span className="flex items-center gap-1 text-xs text-on-surface-muted">
                <User className="h-3 w-3" />
                {milestone.assignedWorkerLabel}
              </span>
            )}
          </div>
          <span className="text-xs font-bold text-brand-text">
            {formatCurrency(milestone.amount)}
          </span>
        </div>

        {/* Due date and revision count */}
        <div className="mt-2 flex items-center gap-3">
          {milestone.dueDate && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs',
                isOverdue ? 'text-accent-coral-600' : 'text-on-surface-muted',
              )}
            >
              {isOverdue ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
              {formatDate(milestone.dueDate)}
            </span>
          )}
          {milestone.revisionCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-brand-text">
              <MessageSquare className="h-3 w-3" />
              {milestone.revisionCount}/2
            </span>
          )}
        </div>
      </button>

      {/* Quick action buttons (visible on hover) */}
      {role === 'talent' && milestone.status === 'pending' && (
        <div className="mt-2 hidden border-t border-outline-dim/10 pt-2 group-hover:block">
          <button
            type="button"
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(milestone.id, 'in_progress')
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-success-600 hover:bg-brand-accent/10 transition-colors disabled:opacity-50"
          >
            <ChevronRight className="h-3 w-3" />
            {t('in_progress')}
          </button>
        </div>
      )}
      {role === 'talent' && milestone.status === 'in_progress' && (
        <div className="mt-2 hidden border-t border-outline-dim/10 pt-2 group-hover:block">
          <button
            type="button"
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(milestone.id, 'submitted')
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-brand-text hover:bg-accent-cream-500/10 transition-colors disabled:opacity-50"
          >
            <ChevronRight className="h-3 w-3" />
            {t('submitted')}
          </button>
        </div>
      )}
    </div>
  )
}
