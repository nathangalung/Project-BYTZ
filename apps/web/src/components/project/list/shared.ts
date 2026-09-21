/** Everything that has not stopped. A dispute or a hold does not stop it. */
export const ACTIVE_STATUSES = new Set([
  'draft',
  'scoping',
  'brd_review',
  'prd_review',
  'matching',
  'in_progress',
  'final_review',
])

/**
 * The two terminal positions.
 *
 * brd_purchased and prd_purchased used to be listed here, which is the bug
 * they were: buying a document filed the project under "finished" while the
 * owner was still working on it. A purchase is paid_at now and moves nothing.
 */
export const COMPLETED_STATUSES = new Set(['completed', 'cancelled'])

export const CATEGORY_CONFIG: Record<string, { key: string; bg: string; text: string }> = {
  web_app: {
    key: 'web_app',
    bg: 'bg-brand-accent/10',
    text: 'text-brand-text',
  },
  mobile_app: {
    key: 'mobile_app',
    bg: 'bg-success-500/10',
    text: 'text-success-500',
  },
  ui_ux_design: {
    key: 'ui_ux_design',
    bg: 'bg-accent-coral-500/10',
    text: 'text-accent-coral-500',
  },
  data_ai: {
    key: 'data_ai',
    bg: 'bg-accent-cream-500/20 dark:bg-accent-cream-500/8',
    text: 'text-brand-text',
  },
  other_digital: {
    key: 'other_digital',
    bg: 'bg-surface-container',
    text: 'text-on-surface-muted',
  },
}

export type ProjectItem = {
  id: string
  title: string
  category: string
  status: string
  budgetMin: number
  budgetMax: number
  createdAt: string
  updatedAt?: string
  teamSize?: number
  progress?: number
  /** Conditions that compose with the position; see ProjectStatusBadge. */
  isDisputed?: boolean
  onHoldAt?: string | null
}
