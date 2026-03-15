import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  Flag,
  Loader2,
  MessageSquare,
  Paperclip,
  User,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProject, useProjectMilestones } from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/milestones')({
  component: MilestoneBoardPage,
})

const COLUMNS = [
  'pending',
  'in_progress',
  'submitted',
  'revision_requested',
  'approved',
  'rejected',
] as const
type ColumnId = (typeof COLUMNS)[number]

const COLUMN_CONFIG: Record<ColumnId, { dotColor: string; headerColor: string }> = {
  pending: { dotColor: 'bg-[#f6f3ab]', headerColor: 'text-[#f6f3ab]' },
  in_progress: { dotColor: 'bg-[#9fc26e]', headerColor: 'text-[#9fc26e]' },
  submitted: { dotColor: 'bg-[#f6f3ab]', headerColor: 'text-[#f6f3ab]' },
  revision_requested: {
    dotColor: 'bg-[#e59a91]',
    headerColor: 'text-[#e59a91]',
  },
  approved: { dotColor: 'bg-[#9fc26e]', headerColor: 'text-[#9fc26e]' },
  rejected: { dotColor: 'bg-[#e59a91]', headerColor: 'text-[#e59a91]' },
}

type MilestoneItem = {
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
}

const MOCK_MILESTONES: MilestoneItem[] = [
  {
    id: 'm1',
    title: 'UI/UX Design System',
    description:
      'Complete design system with Figma components, wireframes, and high-fidelity mockups for all pages.',
    status: 'approved',
    amount: 4000000,
    dueDate: '2026-03-05',
    revisionCount: 1,
    assignedWorkerLabel: 'Worker #3',
    milestoneType: 'individual',
    orderIndex: 1,
  },
  {
    id: 'm2',
    title: 'Database Schema & Migrations',
    description:
      'PostgreSQL schema design with Drizzle ORM, migrations, seed data, and index optimization.',
    status: 'approved',
    amount: 2000000,
    dueDate: '2026-03-10',
    revisionCount: 0,
    assignedWorkerLabel: 'Worker #2',
    milestoneType: 'individual',
    orderIndex: 2,
  },
  {
    id: 'm3',
    title: 'Backend API - Auth & Products',
    description:
      'REST API endpoints for authentication, product CRUD, search, and filtering with Hono framework.',
    status: 'in_progress',
    amount: 4000000,
    dueDate: '2026-03-25',
    revisionCount: 0,
    assignedWorkerLabel: 'Worker #2',
    milestoneType: 'individual',
    orderIndex: 3,
  },
  {
    id: 'm4',
    title: 'Frontend - Product Catalog',
    description:
      'Product listing page with filtering, search, pagination, and detail views. Responsive design.',
    status: 'in_progress',
    amount: 3500000,
    dueDate: '2026-03-28',
    revisionCount: 0,
    assignedWorkerLabel: 'Worker #1',
    milestoneType: 'individual',
    orderIndex: 4,
  },
  {
    id: 'm5',
    title: 'Payment Integration',
    description:
      'Full Midtrans integration with webhook handling, invoice generation, and payment status tracking.',
    status: 'pending',
    amount: 4500000,
    dueDate: '2026-04-10',
    revisionCount: 0,
    assignedWorkerLabel: 'Worker #2',
    milestoneType: 'individual',
    orderIndex: 5,
  },
  {
    id: 'm6',
    title: 'Frontend - Cart & Checkout',
    description:
      'Shopping cart, multi-step checkout flow, promo codes, and order confirmation page.',
    status: 'pending',
    amount: 3000000,
    dueDate: '2026-04-15',
    revisionCount: 0,
    assignedWorkerLabel: 'Worker #1',
    milestoneType: 'individual',
    orderIndex: 6,
  },
  {
    id: 'm7',
    title: 'Subscription Engine',
    description:
      'Recurring billing system with flexible frequency options, subscription dashboard, and auto-retry logic.',
    status: 'pending',
    amount: 3000000,
    dueDate: '2026-04-18',
    revisionCount: 0,
    assignedWorkerLabel: 'Worker #2',
    milestoneType: 'individual',
    orderIndex: 7,
  },
  {
    id: 'm8',
    title: 'Integration Testing & Launch',
    description:
      'End-to-end testing, staging deployment, performance testing, and production launch.',
    status: 'pending',
    amount: 2000000,
    dueDate: '2026-04-25',
    revisionCount: 0,
    assignedWorkerLabel: null,
    milestoneType: 'integration',
    orderIndex: 8,
  },
]

function MilestoneBoardPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { isLoading: milestonesLoading } = useProjectMilestones(projectId)

  const [milestones, setMilestones] = useState<MilestoneItem[]>(MOCK_MILESTONES)
  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneItem | null>(null)

  const groupedMilestones = useCallback(() => {
    const groups: Record<ColumnId, MilestoneItem[]> = {
      pending: [],
      in_progress: [],
      submitted: [],
      revision_requested: [],
      approved: [],
      rejected: [],
    }
    for (const m of milestones) {
      const col = (m.status in groups ? m.status : 'pending') as ColumnId
      groups[col].push(m)
    }
    return groups
  }, [milestones])()

  function handleStatusChange(milestoneId: string, newStatus: ColumnId) {
    setMilestones((prev) =>
      prev.map((m) => (m.id === milestoneId ? { ...m, status: newStatus } : m)),
    )
    if (selectedMilestone?.id === milestoneId) {
      setSelectedMilestone((prev) => (prev ? { ...prev, status: newStatus } : null))
    }
  }

  const isLoading = projectLoading || milestonesLoading

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-[#152e34]">
        <Loader2 className="h-8 w-8 animate-spin text-[#9fc26e]" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-[#152e34]">
      {/* Header */}
      <div className="shrink-0 border-b border-[#5e677d]/20 bg-[#152e34] px-6 py-4">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-[#5e677d] hover:text-[#9fc26e] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {project?.title ?? 'Project'}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#f6f3ab] flex items-center gap-2">
              <Flag className="h-5 w-5 text-[#9fc26e]" />
              {t('milestones')} Board
            </h1>
            <p className="mt-0.5 text-xs text-[#5e677d]">
              {milestones.length} {t('milestones').toLowerCase()}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-[#5e677d]">
              <Wallet className="h-4 w-4" />
              {t('total')}:{' '}
              <span className="font-bold text-[#f6f3ab]">
                {formatCurrency(milestones.reduce((sum, m) => sum + m.amount, 0))}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto bg-[#112630] p-4">
        <div className="flex gap-4" style={{ minWidth: 'fit-content' }}>
          {COLUMNS.map((columnId) => {
            const items = groupedMilestones[columnId]
            const config = COLUMN_CONFIG[columnId]
            return (
              <div key={columnId} className="w-72 shrink-0">
                {/* Column header */}
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#152e34] px-3 py-2 border border-[#5e677d]/10">
                  <span className={cn('h-2.5 w-2.5 rounded-full', config.dotColor)} />
                  <h3 className={cn('text-sm font-semibold', config.headerColor)}>{t(columnId)}</h3>
                  <span className="ml-auto rounded-full bg-[#3b526a] px-2 py-0.5 text-xs font-bold text-[#f6f3ab]">
                    {items.length}
                  </span>
                </div>

                {/* Column cards */}
                <div className="space-y-2">
                  {items
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((milestone) => (
                      <MilestoneCard
                        key={milestone.id}
                        milestone={milestone}
                        onSelect={() => setSelectedMilestone(milestone)}
                        onStatusChange={handleStatusChange}
                      />
                    ))}
                  {items.length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-[#5e677d]/20 p-4 text-center">
                      <p className="text-xs text-[#5e677d]/50">{t('no_milestones')}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Milestone detail slide-over */}
      {selectedMilestone && (
        <MilestoneDetail
          milestone={selectedMilestone}
          onClose={() => setSelectedMilestone(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  )
}

function MilestoneCard({
  milestone,
  onSelect,
  onStatusChange,
}: {
  milestone: MilestoneItem
  onSelect: () => void
  onStatusChange: (id: string, status: ColumnId) => void
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
        'group cursor-pointer rounded-lg border p-3 transition-all hover:border-[#9fc26e]/30',
        isOverdue ? 'bg-[#3b526a] border-[#e59a91]/30' : 'bg-[#3b526a] border-[#5e677d]/15',
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-[#f6f3ab]">{milestone.title}</h4>
          {milestone.milestoneType === 'integration' && (
            <span className="shrink-0 rounded bg-[#e59a91]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#e59a91]">
              Integration
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-1 line-clamp-2 text-xs text-[#5e677d]">{milestone.description}</p>

        {/* Meta row */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {milestone.assignedWorkerLabel && (
              <span className="flex items-center gap-1 text-xs text-[#5e677d]">
                <User className="h-3 w-3" />
                {milestone.assignedWorkerLabel}
              </span>
            )}
          </div>
          <span className="text-xs font-bold text-[#f6f3ab]">
            {formatCurrency(milestone.amount)}
          </span>
        </div>

        {/* Due date and revision count */}
        <div className="mt-2 flex items-center gap-3">
          {milestone.dueDate && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs',
                isOverdue ? 'text-[#e59a91]' : 'text-[#5e677d]',
              )}
            >
              {isOverdue ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
              {formatDate(milestone.dueDate)}
            </span>
          )}
          {milestone.revisionCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-[#f6f3ab]">
              <MessageSquare className="h-3 w-3" />
              {milestone.revisionCount}/2
            </span>
          )}
        </div>
      </button>

      {/* Quick action buttons (visible on hover) */}
      {milestone.status === 'pending' && (
        <div className="mt-2 hidden border-t border-[#5e677d]/15 pt-2 group-hover:block">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(milestone.id, 'in_progress')
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-[#9fc26e] hover:bg-[#9fc26e]/10 transition-colors"
          >
            <ChevronRight className="h-3 w-3" />
            {t('in_progress')}
          </button>
        </div>
      )}
      {milestone.status === 'in_progress' && (
        <div className="mt-2 hidden border-t border-[#5e677d]/15 pt-2 group-hover:block">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(milestone.id, 'submitted')
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-[#f6f3ab] hover:bg-[#f6f3ab]/10 transition-colors"
          >
            <ChevronRight className="h-3 w-3" />
            {t('submitted')}
          </button>
        </div>
      )}
    </div>
  )
}

function MilestoneDetail({
  milestone,
  onClose,
  onStatusChange,
}: {
  milestone: MilestoneItem
  onClose: () => void
  onStatusChange: (id: string, status: ColumnId) => void
}) {
  const { t } = useTranslation('project')

  const isOverdue =
    milestone.dueDate &&
    new Date(milestone.dueDate) < new Date() &&
    milestone.status !== 'approved' &&
    milestone.status !== 'rejected'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md overflow-y-auto bg-[#152e34] shadow-2xl border-l border-[#5e677d]/20">
        <div className="border-b border-[#5e677d]/20 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-[#f6f3ab]">{milestone.title}</h2>
              {milestone.milestoneType === 'integration' && (
                <span className="mt-1 inline-flex items-center gap-1 rounded bg-[#e59a91]/15 px-2 py-0.5 text-xs font-medium text-[#e59a91]">
                  Integration Milestone
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[#5e677d] hover:text-[#f6f3ab] transition-colors"
              aria-label="Close"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Description */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#5e677d]">
              {t('description')}
            </h3>
            <p className="text-sm leading-relaxed text-[#5e677d]">{milestone.description}</p>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-[#112630] p-3 border border-[#5e677d]/10">
              <div className="flex items-center gap-1.5 text-xs text-[#5e677d]">
                <Wallet className="h-3 w-3" />
                {t('amount', 'Nominal')}
              </div>
              <p className="mt-1 text-sm font-bold text-[#f6f3ab]">
                {formatCurrency(milestone.amount)}
              </p>
            </div>
            <div className="rounded-lg bg-[#112630] p-3 border border-[#5e677d]/10">
              <div className="flex items-center gap-1.5 text-xs text-[#5e677d]">
                <Calendar className="h-3 w-3" />
                Due Date
              </div>
              <p
                className={cn(
                  'mt-1 text-sm font-bold',
                  isOverdue ? 'text-[#e59a91]' : 'text-[#f6f3ab]',
                )}
              >
                {milestone.dueDate ? formatDate(milestone.dueDate) : '-'}
              </p>
            </div>
            <div className="rounded-lg bg-[#112630] p-3 border border-[#5e677d]/10">
              <div className="flex items-center gap-1.5 text-xs text-[#5e677d]">
                <User className="h-3 w-3" />
                Worker
              </div>
              <p className="mt-1 text-sm font-bold text-[#f6f3ab]">
                {milestone.assignedWorkerLabel ?? '-'}
              </p>
            </div>
            <div className="rounded-lg bg-[#112630] p-3 border border-[#5e677d]/10">
              <div className="flex items-center gap-1.5 text-xs text-[#5e677d]">
                <MessageSquare className="h-3 w-3" />
                {t('revision_requested', 'Revisi')}
              </div>
              <p className="mt-1 text-sm font-bold text-[#f6f3ab]">{milestone.revisionCount}/2</p>
            </div>
          </div>

          {/* Attachments placeholder */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#5e677d]">
              Attachments
            </h3>
            <div className="rounded-lg border-2 border-dashed border-[#5e677d]/20 p-4 text-center">
              <Paperclip className="mx-auto mb-1 h-5 w-5 text-[#5e677d]/40" />
              <p className="text-xs text-[#5e677d]/50">No attachments yet</p>
            </div>
          </div>

          {/* Actions based on status */}
          <div className="border-t border-[#5e677d]/20 pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#5e677d]">
              Actions
            </h3>
            <div className="flex flex-wrap gap-2">
              {milestone.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => onStatusChange(milestone.id, 'in_progress')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-semibold text-[#0d1e28] hover:bg-[#9fc26e]/90 transition-colors"
                >
                  <Clock className="h-4 w-4" />
                  Start
                </button>
              )}
              {milestone.status === 'in_progress' && (
                <button
                  type="button"
                  onClick={() => onStatusChange(milestone.id, 'submitted')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#f6f3ab] px-4 py-2 text-sm font-semibold text-[#0d1e28] hover:bg-[#f6f3ab]/90 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                  Submit
                </button>
              )}
              {milestone.status === 'submitted' && (
                <>
                  <button
                    type="button"
                    onClick={() => onStatusChange(milestone.id, 'approved')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-semibold text-[#0d1e28] hover:bg-[#9fc26e]/90 transition-colors"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onStatusChange(milestone.id, 'revision_requested')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#f6f3ab]/30 px-4 py-2 text-sm font-medium text-[#f6f3ab] hover:bg-[#3b526a] transition-colors"
                  >
                    <MessageSquare className="h-4 w-4" />
                    {t('request_revision')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onStatusChange(milestone.id, 'rejected')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e59a91]/30 px-4 py-2 text-sm font-medium text-[#e59a91] hover:bg-[#e59a91]/10 transition-colors"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                </>
              )}
              {milestone.status === 'revision_requested' && (
                <button
                  type="button"
                  onClick={() => onStatusChange(milestone.id, 'in_progress')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-semibold text-[#0d1e28] hover:bg-[#9fc26e]/90 transition-colors"
                >
                  <Clock className="h-4 w-4" />
                  Resume Work
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
