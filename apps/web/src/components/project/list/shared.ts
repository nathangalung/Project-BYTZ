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
