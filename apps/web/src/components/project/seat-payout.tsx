import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/utils'

export type SeatPayoutFields = {
  payoutMin: number | null
  payoutMax: number | null
  openPositions: number
}

/**
 * What a talent would be paid for a seat still open on this project.
 *
 * Browse cards used to print budget_min and budget_max, the range the owner
 * typed at intake before the AI priced anything, so the figure a talent decided
 * on could be several times the one on offer. The owner's price and the
 * platform fee stay off this card: the server never sends them, and the fee is
 * stated as included in the project price rather than deducted from a quote.
 */
export function SeatPayout({ payoutMin, payoutMax, openPositions }: SeatPayoutFields) {
  const { t } = useTranslation('project')

  if (openPositions < 1 || payoutMin === null || payoutMax === null) {
    return <span className="text-sm text-on-surface-subtle">{t('seat_payout_closed')}</span>
  }

  return (
    <div>
      <span className="block text-xs text-on-surface-muted">{t('seat_payout_label')}</span>
      <span className="text-sm font-bold text-on-surface">
        {payoutMin === payoutMax
          ? formatCurrency(payoutMin)
          : `${formatCurrency(payoutMin)} - ${formatCurrency(payoutMax)}`}
      </span>
    </div>
  )
}
