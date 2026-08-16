export const ACTIVE_STATUSES = new Set([
  'draft',
  'scoping',
  'brd_generated',
  'brd_approved',
  'prd_generated',
  'prd_approved',
  'matching',
  'team_forming',
  'matched',
  'in_progress',
  'partially_active',
  'review',
  'on_hold',
  'disputed',
])

export const COMPLETED_STATUSES = new Set([
  'completed',
  'cancelled',
  'brd_purchased',
  'prd_purchased',
])

export const STATUS_CONFIG: Record<string, { key: string; bg: string; text: string }> = {
  draft: {
    key: 'status_draft',
    bg: 'bg-surface-container/60',
    text: 'text-on-surface-muted',
  },
  scoping: {
    key: 'status_scoping',
    bg: 'bg-brand-accent/10',
    text: 'text-brand-text',
  },
  brd_generated: {
    key: 'status_brd_generated',
    bg: 'bg-accent-cream-500/20 dark:bg-accent-cream-500/8',
    text: 'text-brand-text',
  },
  brd_approved: {
    key: 'status_brd_approved',
    bg: 'bg-warning-500/20',
    text: 'text-brand-text',
  },
  brd_purchased: {
    key: 'status_brd_purchased',
    bg: 'bg-accent-cream-500/20 dark:bg-accent-cream-500/8',
    text: 'text-brand-text',
  },
  prd_generated: {
    key: 'status_prd_generated',
    bg: 'bg-brand-accent/10',
    text: 'text-brand-text',
  },
  prd_approved: {
    key: 'status_prd_approved',
    bg: 'bg-brand-accent/10',
    text: 'text-brand-text',
  },
  prd_purchased: {
    key: 'status_prd_purchased',
    bg: 'bg-brand-accent/10',
    text: 'text-brand-text',
  },
  matching: {
    key: 'status_matching',
    bg: 'bg-accent-coral-500/10',
    text: 'text-accent-coral-500',
  },
  team_forming: {
    key: 'status_team_forming',
    bg: 'bg-accent-coral-500/10',
    text: 'text-accent-coral-500',
  },
  matched: {
    key: 'status_matched',
    bg: 'bg-success-500/10',
    text: 'text-success-500',
  },
  in_progress: {
    key: 'status_in_progress',
    bg: 'bg-success-500/10',
    text: 'text-success-500',
  },
  partially_active: {
    key: 'status_partially_active',
    bg: 'bg-warning-500/20',
    text: 'text-brand-text',
  },
  review: {
    key: 'status_review',
    bg: 'bg-brand-accent/10',
    text: 'text-brand-text',
  },
  completed: {
    key: 'status_completed',
    bg: 'bg-success-500/20',
    text: 'text-success-500',
  },
  cancelled: {
    key: 'status_cancelled',
    bg: 'bg-error-500/10',
    text: 'text-error-500',
  },
  disputed: {
    key: 'status_disputed',
    bg: 'bg-error-500/10',
    text: 'text-error-500',
  },
  on_hold: {
    key: 'status_on_hold',
    bg: 'bg-warning-500/20',
    text: 'text-brand-text',
  },
}

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
}
