import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Flag,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProject, useProjectMilestones } from '@/hooks/use-projects'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/')({
  component: ProjectDetailPage,
})

const TABS = ['overview', 'milestones', 'chat', 'documents'] as const
type Tab = (typeof TABS)[number]

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  overview: <LayoutDashboard className="h-4 w-4" />,
  milestones: <Flag className="h-4 w-4" />,
  chat: <MessageSquare className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-[#5e677d]/20 text-[#5e677d] border border-[#5e677d]/30',
  scoping: 'bg-[#f6f3ab]/10 text-[#f6f3ab] border border-[#f6f3ab]/20',
  brd_generated: 'bg-[#f6f3ab]/15 text-[#f6f3ab] border border-[#f6f3ab]/30',
  brd_approved: 'bg-[#9fc26e]/10 text-[#9fc26e] border border-[#9fc26e]/20',
  brd_purchased: 'bg-[#9fc26e]/15 text-[#9fc26e] border border-[#9fc26e]/30',
  prd_generated: 'bg-[#e59a91]/10 text-[#e59a91] border border-[#e59a91]/20',
  prd_approved: 'bg-[#e59a91]/15 text-[#e59a91] border border-[#e59a91]/30',
  matching: 'bg-[#f6f3ab]/10 text-[#f6f3ab] border border-[#f6f3ab]/20',
  matched: 'bg-[#9fc26e]/10 text-[#9fc26e] border border-[#9fc26e]/20',
  in_progress: 'bg-[#9fc26e]/15 text-[#9fc26e] border border-[#9fc26e]/30',
  review: 'bg-[#f6f3ab]/15 text-[#f6f3ab] border border-[#f6f3ab]/30',
  completed: 'bg-[#9fc26e]/20 text-[#9fc26e] border border-[#9fc26e]/40',
  cancelled: 'bg-[#e59a91]/15 text-[#e59a91] border border-[#e59a91]/30',
  disputed: 'bg-[#e59a91]/20 text-[#e59a91] border border-[#e59a91]/40',
  on_hold: 'bg-[#5e677d]/20 text-[#5e677d] border border-[#5e677d]/30',
}

const CATEGORY_COLORS: Record<string, string> = {
  web_app: 'bg-[#9fc26e]/10 text-[#9fc26e] border border-[#9fc26e]/20',
  mobile_app: 'bg-[#e59a91]/10 text-[#e59a91] border border-[#e59a91]/20',
  ui_ux_design: 'bg-[#f6f3ab]/10 text-[#f6f3ab] border border-[#f6f3ab]/20',
  data_ai: 'bg-[#e59a91]/10 text-[#e59a91] border border-[#e59a91]/20',
  other_digital: 'bg-[#5e677d]/15 text-[#5e677d] border border-[#5e677d]/30',
}

const MILESTONE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#5e677d]/20 text-[#5e677d]',
  in_progress: 'bg-[#f6f3ab]/15 text-[#f6f3ab]',
  submitted: 'bg-[#f6f3ab]/20 text-[#f6f3ab]',
  revision_requested: 'bg-[#e59a91]/15 text-[#e59a91]',
  approved: 'bg-[#9fc26e]/15 text-[#9fc26e]',
  rejected: 'bg-[#e59a91]/20 text-[#e59a91]',
}

const DUMMY_PROJECT = {
  id: 'proj-dummy-001',
  title: 'KopiNusantara E-Commerce Platform',
  description:
    'A premium e-commerce platform for artisan Indonesian coffee beans with subscription management, integrated Midtrans payments, and an admin inventory dashboard. Targeting individual consumers and small cafes across Indonesia.',
  category: 'web_app',
  status: 'in_progress',
  budgetMin: 18000000,
  budgetMax: 28000000,
  estimatedTimelineDays: 45,
  teamSize: 3,
  finalPrice: 24500000,
  createdAt: '2026-02-10T08:00:00Z',
  updatedAt: '2026-03-14T16:30:00Z',
}

const DUMMY_MILESTONES = [
  {
    id: 'm1',
    title: 'UI/UX Design System',
    description: 'Complete design system, wireframes, and high-fidelity mockups for all pages',
    status: 'approved',
    amount: 4000000,
    dueDate: '2026-03-05',
  },
  {
    id: 'm2',
    title: 'Backend API Core',
    description: 'Authentication, product CRUD, order management REST endpoints',
    status: 'in_progress',
    amount: 6000000,
    dueDate: '2026-03-25',
  },
  {
    id: 'm3',
    title: 'Frontend Product Catalog',
    description: 'Product listing, filtering, search, and detail pages with responsive design',
    status: 'in_progress',
    amount: 5000000,
    dueDate: '2026-04-01',
  },
  {
    id: 'm4',
    title: 'Payment Integration',
    description: 'Full Midtrans integration with webhook handlers and invoice generation',
    status: 'pending',
    amount: 4500000,
    dueDate: '2026-04-10',
  },
  {
    id: 'm5',
    title: 'Subscription Engine',
    description: 'Recurring billing, subscription management dashboard, and notification system',
    status: 'pending',
    amount: 3000000,
    dueDate: '2026-04-18',
  },
  {
    id: 'm6',
    title: 'Integration Testing & Deploy',
    description: 'End-to-end testing, staging deployment, and production launch',
    status: 'pending',
    amount: 2000000,
    dueDate: '2026-04-25',
  },
]

function ProjectDetailPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const { data: project, isLoading } = useProject(projectId)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  const displayProject = project ?? DUMMY_PROJECT

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-[#152e34]">
        <Loader2 className="h-8 w-8 animate-spin text-[#9fc26e]" />
      </div>
    )
  }

  const statusColor = STATUS_COLORS[displayProject.status] ?? STATUS_COLORS.draft
  const categoryColor = CATEGORY_COLORS[displayProject.category] ?? CATEGORY_COLORS.other_digital

  return (
    <div className="min-h-screen bg-[#152e34] p-6 lg:p-8">
      {/* Breadcrumb / back */}
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[#5e677d] hover:text-[#9fc26e] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('my_projects')}
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#f6f3ab] tracking-tight">
            {displayProject.title}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', categoryColor)}>
              <Tag className="mr-1 inline h-3 w-3" />
              {t(displayProject.category)}
            </span>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', statusColor)}>
              {t(`status_${displayProject.status}`)}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {(displayProject.status === 'draft' || displayProject.status === 'scoping') && (
            <Link
              to="/projects/$projectId/scoping"
              params={{ projectId }}
              className="inline-flex items-center gap-2 rounded-lg bg-[#9fc26e] px-4 py-2.5 text-sm font-medium text-[#0d1e28] hover:bg-[#9fc26e]/90 transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              {t('scoping_title')}
            </Link>
          )}
          {(displayProject.status === 'brd_generated' ||
            displayProject.status === 'brd_approved') && (
            <Link
              to="/projects/$projectId/brd"
              params={{ projectId }}
              className="inline-flex items-center gap-2 rounded-lg bg-[#e59a91] px-4 py-2.5 text-sm font-medium text-[#0d1e28] hover:bg-[#e59a91]/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              {t('brd_title')}
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-[#5e677d]/20">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'border-[#9fc26e] text-[#9fc26e]'
                  : 'border-transparent text-[#5e677d] hover:border-[#5e677d]/40 hover:text-[#f6f3ab]/80',
              )}
            >
              {TAB_ICONS[tab]}
              {t(tab)}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab project={displayProject} />}
      {activeTab === 'milestones' && <MilestonesTab projectId={projectId} />}
      {activeTab === 'chat' && <ChatTab projectId={projectId} />}
      {activeTab === 'documents' && <DocumentsTab projectId={projectId} />}
    </div>
  )
}

function OverviewTab({
  project,
}: {
  project: {
    description: string
    budgetMin: number
    budgetMax: number
    estimatedTimelineDays: number
    teamSize: number
    finalPrice: number | null
    createdAt: string
    updatedAt: string
  }
}) {
  const { t } = useTranslation('project')

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-xl bg-[#3b526a] p-6 border border-[#5e677d]/20">
          <h3 className="mb-3 text-sm font-semibold text-[#f6f3ab]">{t('description')}</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#5e677d]">
            {project.description}
          </p>
        </div>

        {/* Progress summary */}
        <div className="rounded-xl bg-[#3b526a] p-6 border border-[#5e677d]/20">
          <h3 className="mb-4 text-sm font-semibold text-[#f6f3ab] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#9fc26e]" />
            {t('overview')}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-[#112630] p-4 text-center border border-[#5e677d]/10">
              <TrendingUp className="mx-auto mb-1.5 h-5 w-5 text-[#9fc26e]" />
              <p className="text-xs text-[#5e677d]">{t('overall_progress')}</p>
              <p className="mt-0.5 text-lg font-bold text-[#f6f3ab]">35%</p>
            </div>
            <div className="rounded-lg bg-[#112630] p-4 text-center border border-[#5e677d]/10">
              <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-[#9fc26e]" />
              <p className="text-xs text-[#5e677d]">{t('milestones')}</p>
              <p className="mt-0.5 text-lg font-bold text-[#f6f3ab]">1/6</p>
            </div>
            <div className="rounded-lg bg-[#112630] p-4 text-center border border-[#5e677d]/10">
              <Clock className="mx-auto mb-1.5 h-5 w-5 text-[#f6f3ab]" />
              <p className="text-xs text-[#5e677d]">{t('days_remaining')}</p>
              <p className="mt-0.5 text-lg font-bold text-[#f6f3ab]">31</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20">
          <h3 className="mb-4 text-sm font-semibold text-[#f6f3ab]">
            {t('budget')} & {t('timeline')}
          </h3>
          <div className="space-y-3">
            <InfoRow
              icon={<Wallet className="h-4 w-4 text-[#5e677d]" />}
              label={t('budget')}
              value={`${formatCurrency(project.budgetMin)} - ${formatCurrency(project.budgetMax)}`}
            />
            <InfoRow
              icon={<Clock className="h-4 w-4 text-[#5e677d]" />}
              label={t('estimated_timeline')}
              value={`${project.estimatedTimelineDays} ${t('days')}`}
            />
            <InfoRow
              icon={<Users className="h-4 w-4 text-[#5e677d]" />}
              label={t('team_size')}
              value={String(project.teamSize)}
            />
            {project.finalPrice && (
              <InfoRow
                icon={<Wallet className="h-4 w-4 text-[#9fc26e]" />}
                label={t('final_price')}
                value={formatCurrency(project.finalPrice)}
                highlight
              />
            )}
          </div>
        </div>

        <div className="rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20">
          <h3 className="mb-4 text-sm font-semibold text-[#f6f3ab]">{t('key_dates')}</h3>
          <div className="space-y-3">
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-[#5e677d]" />}
              label={t('created_at')}
              value={formatDate(project.createdAt)}
            />
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-[#5e677d]" />}
              label={t('updated_at')}
              value={formatDate(project.updatedAt)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-xs text-[#5e677d]">{label}</span>
      <span
        className={cn(
          'ml-auto text-sm font-medium',
          highlight ? 'text-[#9fc26e]' : 'text-[#f6f3ab]',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function MilestonesTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')
  const { data: milestones, isLoading } = useProjectMilestones(projectId)

  const displayMilestones = milestones && milestones.length > 0 ? milestones : DUMMY_MILESTONES

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((id) => (
          <div key={id} className="h-32 animate-pulse rounded-lg bg-[#3b526a]" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {displayMilestones.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-4 rounded-xl bg-[#3b526a] p-4 border border-[#5e677d]/20"
        >
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              m.status === 'approved'
                ? 'bg-[#9fc26e]/15'
                : m.status === 'in_progress'
                  ? 'bg-[#f6f3ab]/15'
                  : 'bg-[#5e677d]/15',
            )}
          >
            {m.status === 'approved' ? (
              <CheckCircle2 className="h-5 w-5 text-[#9fc26e]" />
            ) : m.status === 'in_progress' ? (
              <Activity className="h-5 w-5 text-[#f6f3ab]" />
            ) : (
              <Clock className="h-5 w-5 text-[#5e677d]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-[#f6f3ab]">{m.title}</h4>
            <p className="mt-0.5 text-xs text-[#5e677d] line-clamp-1">{m.description}</p>
          </div>
          <div className="text-right shrink-0">
            <span
              className={cn(
                'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
                MILESTONE_STATUS_COLORS[m.status] ?? MILESTONE_STATUS_COLORS.pending,
              )}
            >
              {t(m.status)}
            </span>
            {m.dueDate && <p className="mt-1 text-xs text-[#5e677d]">{formatDate(m.dueDate)}</p>}
          </div>
          <span className="shrink-0 text-sm font-semibold text-[#f6f3ab]">
            {formatCurrency(m.amount)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ChatTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')

  return (
    <div className="flex flex-col items-center justify-center rounded-xl bg-[#3b526a] border border-[#5e677d]/20 py-12">
      <MessageSquare className="mb-3 h-8 w-8 text-[#5e677d]" />
      <p className="text-sm text-[#5e677d]">{t('chat')} - Coming soon</p>
      <Link
        to="/projects/$projectId/scoping"
        params={{ projectId }}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-medium text-[#0d1e28] hover:bg-[#9fc26e]/90 transition-colors"
      >
        {t('go_to_scoping')}
      </Link>
    </div>
  )
}

function DocumentsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/projects/$projectId/brd"
          params={{ projectId }}
          className="flex items-center gap-4 rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20 hover:border-[#9fc26e]/30 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#e59a91]/15">
            <FileText className="h-6 w-6 text-[#e59a91]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#f6f3ab]">{t('brd_title')}</h3>
            <p className="text-xs text-[#5e677d]">Business Requirement Document</p>
          </div>
        </Link>
        <Link
          to="/projects/$projectId/prd"
          params={{ projectId }}
          className="flex items-center gap-4 rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20 hover:border-[#9fc26e]/30 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#9fc26e]/15">
            <FileText className="h-6 w-6 text-[#9fc26e]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#f6f3ab]">Product Requirement Document</h3>
            <p className="text-xs text-[#5e677d]">PRD</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
