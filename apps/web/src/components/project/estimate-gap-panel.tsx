import { budgetGap, type EstimateGap, timelineGap } from '@kerjacus/shared'
import { AlertTriangle, Check, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/utils'

/**
 * The owner's own answers held against the document's estimate.
 *
 * At the decision point after a BRD or PRD, the owner is choosing whether to
 * carry on into development. Both numbers already existed and neither was ever
 * shown next to the other, so the comparison was theirs to do by hand across
 * two pages.
 *
 * This is a prompt, not a workflow. There is no negotiation state anywhere in
 * this codebase, and inventing one would be a feature rather than the reading
 * that was missing - the same line `graceLapsedMilestones` draws between
 * surfacing a remedy and gating on it. What it does is name the gap and both
 * numbers, so the owner can raise it in the chat they already have.
 */

type Props = {
  ownerBudgetMax: number
  ownerTimelineDays: number
  estimatedPriceMin: number
  estimatedPriceMax: number
  estimatedTimelineDays: number
}

function GapRow({
  label,
  gap,
  format,
}: {
  label: string
  gap: EstimateGap
  format: (value: number) => string
}) {
  const { t } = useTranslation('project')

  const tone =
    gap.kind === 'fits'
      ? 'text-success-600'
      : gap.kind === 'over'
        ? 'text-error-600'
        : 'text-on-surface-muted'
  const Icon = gap.kind === 'fits' ? Check : gap.kind === 'over' ? AlertTriangle : Minus

  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-on-surface-muted">{label}</span>
      <span className={`flex items-start gap-2 text-right text-sm font-medium ${tone}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {gap.kind === 'unknown' && t('gap_unknown')}
          {gap.kind === 'fits' && t('gap_fits', { value: format(gap.estimate) })}
          {gap.kind === 'over' && (
            <>
              {t('gap_over', {
                value: format(gap.estimate),
                over: format(gap.shortfall),
                ceiling: format(gap.ceiling),
              })}
              {gap.lowEndFits ? ` ${t('gap_low_end_fits')}` : ''}
            </>
          )}
        </span>
      </span>
    </div>
  )
}

export function EstimateGapPanel({
  ownerBudgetMax,
  ownerTimelineDays,
  estimatedPriceMin,
  estimatedPriceMax,
  estimatedTimelineDays,
}: Props) {
  const { t } = useTranslation('project')
  const budget = budgetGap(ownerBudgetMax, estimatedPriceMin, estimatedPriceMax)
  const timeline = timelineGap(ownerTimelineDays, estimatedTimelineDays)

  // Nothing comparable is not a finding, so it is not a panel.
  if (budget.kind === 'unknown' && timeline.kind === 'unknown') return null

  const overrun = budget.kind === 'over' || timeline.kind === 'over'

  return (
    <section className="rounded-xl border border-outline-dim/20 bg-surface-bright p-5">
      <h3 className="text-sm font-bold text-brand-text">{t('gap_title')}</h3>
      <div className="mt-2 divide-y divide-outline-dim/10">
        <GapRow label={t('gap_budget_label')} gap={budget} format={formatCurrency} />
        <GapRow
          label={t('gap_timeline_label')}
          gap={timeline}
          format={(days) => `${days} ${t('days')}`}
        />
      </div>
      {overrun && <p className="mt-3 text-sm text-on-surface-muted">{t('gap_discuss_hint')}</p>}
    </section>
  )
}
