export const COLUMNS = [
  'pending',
  'in_progress',
  'submitted',
  'revision_requested',
  'approved',
  'rejected',
] as const
export type ColumnId = (typeof COLUMNS)[number]

export const COLUMN_CONFIG: Record<ColumnId, { dotColor: string; headerColor: string }> = {
  pending: { dotColor: 'bg-accent-cream-500', headerColor: 'text-primary-600' },
  in_progress: { dotColor: 'bg-primary-600', headerColor: 'text-success-600' },
  submitted: { dotColor: 'bg-accent-cream-500', headerColor: 'text-primary-600' },
  revision_requested: {
    dotColor: 'bg-accent-coral-500',
    headerColor: 'text-accent-coral-600',
  },
  approved: { dotColor: 'bg-primary-600', headerColor: 'text-success-600' },
  rejected: { dotColor: 'bg-accent-coral-500', headerColor: 'text-accent-coral-600' },
}

export type MilestoneItem = {
  id: string
  title: string
  description: string
  status: string
  amount: number
  dueDate: string | null
  revisionCount: number
  assignedWorkerLabel: string | null
  milestoneType: 'individual' | 'integration'
  orderIndex: number
  metadata: { deliverables?: Deliverable[] } | null
}

export type Deliverable = {
  title: string
  type?: string
  expected?: string
  submitted_url?: string
  status?: string
}

export type MilestoneComment = {
  id: string
  userId: string
  content: string
  createdAt: string
}

export type MilestoneFile = {
  id: string
  milestoneId: string
  fileName: string
  fileUrl: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  createdAt: string
}

/** Attachment sizes, rendered on the milestone detail. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
