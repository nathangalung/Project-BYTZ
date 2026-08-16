import { Clock, FileText, Flag, LayoutDashboard, TrendingUp, Users, Wallet } from 'lucide-react'

export const TABS = ['overview', 'milestones', 'documents', 'time-tracking'] as const
export type Tab = (typeof TABS)[number]

export const TAB_ROUTES: Record<Exclude<Tab, 'overview'>, string> = {
  milestones: '/projects/$projectId/milestones',
  documents: '/projects/$projectId/documents',
  'time-tracking': '/projects/$projectId/time-tracking',
}

export const TAB_ICONS: Record<Tab, React.ReactNode> = {
  overview: <LayoutDashboard className="h-4 w-4" />,
  milestones: <Flag className="h-4 w-4" />,
  'time-tracking': <Clock className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
}

export const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-surface-container/40 text-on-surface-muted border border-outline-dim/20',
  scoping: 'bg-accent-cream-500/10 text-brand-text border border-accent-cream-500/20',
  brd_generated: 'bg-accent-cream-500/15 text-brand-text border border-accent-cream-500/30',
  brd_approved: 'bg-brand-accent/10 text-success-600 border border-success-500/20',
  brd_purchased: 'bg-brand-accent/15 text-success-600 border border-success-500/30',
  prd_generated: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  prd_approved: 'bg-accent-coral-500/15 text-accent-coral-600 border border-accent-coral-500/30',
  matching: 'bg-accent-cream-500/10 text-brand-text border border-accent-cream-500/20',
  matched: 'bg-brand-accent/10 text-success-600 border border-success-500/20',
  in_progress: 'bg-brand-accent/15 text-success-600 border border-success-500/30',
  review: 'bg-accent-cream-500/15 text-brand-text border border-accent-cream-500/30',
  completed: 'bg-brand-accent/20 text-success-600 border border-success-500/40',
  cancelled: 'bg-accent-coral-500/15 text-accent-coral-600 border border-accent-coral-500/30',
  disputed: 'bg-accent-coral-500/20 text-accent-coral-600 border border-accent-coral-500/40',
  on_hold: 'bg-surface-container/40 text-on-surface-muted border border-outline-dim/20',
}

export const CATEGORY_COLORS: Record<string, string> = {
  web_app: 'bg-brand-accent/10 text-success-600 border border-success-500/20',
  mobile_app: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  ui_ux_design: 'bg-accent-cream-500/10 text-brand-text border border-accent-cream-500/20',
  data_ai: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  other_digital: 'bg-surface-container/40 text-on-surface-muted border border-outline-dim/20',
}

export const DISPUTE_STATUS_COLORS: Record<string, string> = {
  open: 'bg-accent-coral-500/10 text-accent-coral-600 border border-accent-coral-500/20',
  under_review: 'bg-accent-cream-500/10 text-brand-text border border-accent-cream-500/20',
  mediation: 'bg-accent-cream-500/15 text-brand-text border border-accent-cream-500/30',
  escalated: 'bg-accent-coral-500/20 text-accent-coral-600 border border-accent-coral-500/40',
  resolved: 'bg-brand-accent/10 text-success-600 border border-success-500/20',
}

export const RESOLUTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  funds_to_talent: <TrendingUp className="h-4 w-4 text-success-600" />,
  funds_to_owner: <Wallet className="h-4 w-4 text-accent-coral-600" />,
  split: <Users className="h-4 w-4 text-brand-text" />,
}
