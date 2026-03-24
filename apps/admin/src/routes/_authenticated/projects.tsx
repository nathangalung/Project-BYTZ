import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  DollarSign,
  Milestone,
  RefreshCw,
  Search,
  Users as UsersIcon,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects')({
  component: AdminProjectsPage,
})

type MilestoneData = {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'revision_requested'
  amount: number
  workerName: string | null
  dueDate: string
}

type TalentAssignment = {
  id: string
  name: string
  roleLabel: string
  status: 'active' | 'completed' | 'terminated'
}

type Transaction = {
  id: string
  type: string
  amount: number
  status: string
  date: string
}

type ProjectRow = {
  id: string
  title: string
  description: string
  clientName: string
  ownerId: string
  status: string
  category: string
  teamSize: number
  budgetMin: number
  budgetMax: number
  finalPrice: number | null
  platformFee: number | null
  estimatedDays: number
  healthScore: number
  createdAt: string
  dueDate: string | null
  workers: TalentAssignment[]
  milestones: MilestoneData[]
  transactions: Transaction[]
}

const MOCK_PROJECTS: ProjectRow[] = [
  {
    id: 'p1',
    title: 'E-commerce Platform UMKM',
    description:
      'Full-stack e-commerce platform with payment integration, inventory management, and admin dashboard for UMKM businesses.',
    clientName: 'Ahmad Budiman',
    ownerId: 'u1',
    status: 'in_progress',
    category: 'web_app',
    teamSize: 3,
    budgetMin: 50000000,
    budgetMax: 80000000,
    finalPrice: 72000000,
    platformFee: 14400000,
    estimatedDays: 60,
    healthScore: 72,
    createdAt: '2026-01-15T08:00:00Z',
    dueDate: '2026-03-15T00:00:00Z',
    workers: [
      { id: 'w1', name: 'Siti Rahayu', roleLabel: 'Backend Developer', status: 'active' },
      { id: 'w2', name: 'Eko Prasetyo', roleLabel: 'Frontend Developer', status: 'active' },
      { id: 'w3', name: 'Gunawan H.', roleLabel: 'UI/UX Designer', status: 'completed' },
    ],
    milestones: [
      {
        id: 'ms1',
        title: 'UI/UX Design Complete',
        status: 'approved',
        amount: 12000000,
        workerName: 'Gunawan H.',
        dueDate: '2026-02-01',
      },
      {
        id: 'ms2',
        title: 'Backend API v1',
        status: 'approved',
        amount: 18000000,
        workerName: 'Siti Rahayu',
        dueDate: '2026-02-15',
      },
      {
        id: 'ms3',
        title: 'Frontend Integration',
        status: 'in_progress',
        amount: 15000000,
        workerName: 'Eko Prasetyo',
        dueDate: '2026-03-01',
      },
      {
        id: 'ms4',
        title: 'Payment Gateway',
        status: 'pending',
        amount: 12000000,
        workerName: 'Siti Rahayu',
        dueDate: '2026-03-10',
      },
      {
        id: 'ms5',
        title: 'Final Testing & Deploy',
        status: 'pending',
        amount: 15000000,
        workerName: null,
        dueDate: '2026-03-15',
      },
    ],
    transactions: [
      { id: 't1', type: 'escrow_in', amount: 72000000, status: 'completed', date: '2026-01-20' },
      {
        id: 't2',
        type: 'escrow_release',
        amount: 12000000,
        status: 'completed',
        date: '2026-02-05',
      },
      {
        id: 't3',
        type: 'escrow_release',
        amount: 18000000,
        status: 'completed',
        date: '2026-02-20',
      },
    ],
  },
  {
    id: 'p2',
    title: 'Mobile App Delivery Tracking',
    description:
      'Real-time delivery tracking mobile application with driver management and customer notifications.',
    clientName: 'Hana Permata',
    ownerId: 'u8',
    status: 'matching',
    category: 'mobile_app',
    teamSize: 2,
    budgetMin: 30000000,
    budgetMax: 50000000,
    finalPrice: null,
    platformFee: null,
    estimatedDays: 45,
    healthScore: 90,
    createdAt: '2026-02-20T10:00:00Z',
    dueDate: null,
    workers: [],
    milestones: [],
    transactions: [],
  },
  {
    id: 'p3',
    title: 'Dashboard Analytics Internal',
    description:
      'Internal BI dashboard with data visualization, report generation, and KPI tracking.',
    clientName: 'Ahmad Budiman',
    ownerId: 'u1',
    status: 'completed',
    category: 'data_ai',
    teamSize: 1,
    budgetMin: 15000000,
    budgetMax: 25000000,
    finalPrice: 20000000,
    platformFee: 5000000,
    estimatedDays: 30,
    healthScore: 95,
    createdAt: '2025-11-05T14:00:00Z',
    dueDate: '2025-12-05',
    workers: [
      { id: 'w4', name: 'Irfan Maulana', roleLabel: 'Fullstack Developer', status: 'completed' },
    ],
    milestones: [
      {
        id: 'ms6',
        title: 'Database & API',
        status: 'approved',
        amount: 8000000,
        workerName: 'Irfan Maulana',
        dueDate: '2025-11-20',
      },
      {
        id: 'ms7',
        title: 'Dashboard UI',
        status: 'approved',
        amount: 7000000,
        workerName: 'Irfan Maulana',
        dueDate: '2025-11-30',
      },
      {
        id: 'ms8',
        title: 'Reports & Deploy',
        status: 'approved',
        amount: 5000000,
        workerName: 'Irfan Maulana',
        dueDate: '2025-12-05',
      },
    ],
    transactions: [
      { id: 't4', type: 'escrow_in', amount: 20000000, status: 'completed', date: '2025-11-10' },
      {
        id: 't5',
        type: 'escrow_release',
        amount: 8000000,
        status: 'completed',
        date: '2025-11-22',
      },
      {
        id: 't6',
        type: 'escrow_release',
        amount: 7000000,
        status: 'completed',
        date: '2025-12-02',
      },
      {
        id: 't7',
        type: 'escrow_release',
        amount: 5000000,
        status: 'completed',
        date: '2025-12-06',
      },
    ],
  },
  {
    id: 'p4',
    title: 'Redesign UI/UX Website Korporasi',
    description:
      'Complete redesign of corporate website with modern UI/UX, responsive design, and brand refresh.',
    clientName: 'Hana Permata',
    ownerId: 'u8',
    status: 'brd_generated',
    category: 'ui_ux_design',
    teamSize: 1,
    budgetMin: 10000000,
    budgetMax: 20000000,
    finalPrice: null,
    platformFee: null,
    estimatedDays: 21,
    healthScore: 100,
    createdAt: '2026-03-01T09:00:00Z',
    dueDate: null,
    workers: [],
    milestones: [],
    transactions: [],
  },
  {
    id: 'p5',
    title: 'Sistem Manajemen Inventori',
    description:
      'Inventory management system with barcode scanning, stock alerts, and supplier management.',
    clientName: 'Joko Widodo',
    ownerId: 'u10',
    status: 'prd_approved',
    category: 'web_app',
    teamSize: 2,
    budgetMin: 40000000,
    budgetMax: 60000000,
    finalPrice: 55000000,
    platformFee: 11000000,
    estimatedDays: 50,
    healthScore: 85,
    createdAt: '2026-02-10T11:00:00Z',
    dueDate: null,
    workers: [],
    milestones: [],
    transactions: [],
  },
  {
    id: 'p6',
    title: 'Landing Page Produk Baru',
    description: 'Marketing landing page for new product launch with lead capture forms.',
    clientName: 'Dewi Lestari',
    ownerId: 'u4',
    status: 'cancelled',
    category: 'web_app',
    teamSize: 1,
    budgetMin: 5000000,
    budgetMax: 10000000,
    finalPrice: null,
    platformFee: null,
    estimatedDays: 14,
    healthScore: 0,
    createdAt: '2026-01-08T16:00:00Z',
    dueDate: null,
    workers: [],
    milestones: [],
    transactions: [],
  },
  {
    id: 'p7',
    title: 'Chatbot Customer Service AI',
    description:
      'AI-powered customer service chatbot with NLP, sentiment analysis, and integration with existing CRM.',
    clientName: 'Ahmad Budiman',
    ownerId: 'u1',
    status: 'disputed',
    category: 'data_ai',
    teamSize: 1,
    budgetMin: 20000000,
    budgetMax: 35000000,
    finalPrice: 28000000,
    platformFee: 5600000,
    estimatedDays: 40,
    healthScore: 25,
    createdAt: '2025-12-15T13:00:00Z',
    dueDate: '2026-01-25',
    workers: [{ id: 'w5', name: 'Siti Rahayu', roleLabel: 'AI/ML Engineer', status: 'active' }],
    milestones: [
      {
        id: 'ms9',
        title: 'NLP Model Training',
        status: 'approved',
        amount: 10000000,
        workerName: 'Siti Rahayu',
        dueDate: '2026-01-05',
      },
      {
        id: 'ms10',
        title: 'Chat UI & Integration',
        status: 'rejected',
        amount: 10000000,
        workerName: 'Siti Rahayu',
        dueDate: '2026-01-15',
      },
      {
        id: 'ms11',
        title: 'Deploy & Monitoring',
        status: 'pending',
        amount: 8000000,
        workerName: 'Siti Rahayu',
        dueDate: '2026-01-25',
      },
    ],
    transactions: [
      { id: 't8', type: 'escrow_in', amount: 28000000, status: 'completed', date: '2025-12-20' },
      {
        id: 't9',
        type: 'escrow_release',
        amount: 10000000,
        status: 'completed',
        date: '2026-01-08',
      },
    ],
  },
  {
    id: 'p8',
    title: 'Aplikasi Mobile Fitness',
    description:
      'Fitness tracking mobile app with workout plans, progress tracking, nutrition logging, and social features.',
    clientName: 'Hana Permata',
    ownerId: 'u8',
    status: 'review',
    category: 'mobile_app',
    teamSize: 3,
    budgetMin: 60000000,
    budgetMax: 90000000,
    finalPrice: 85000000,
    platformFee: 12750000,
    estimatedDays: 75,
    healthScore: 88,
    createdAt: '2025-10-22T08:00:00Z',
    dueDate: '2026-01-05',
    workers: [
      { id: 'w6', name: 'Budi Santoso', roleLabel: 'Mobile Developer', status: 'completed' },
      { id: 'w7', name: 'Gunawan H.', roleLabel: 'Backend Developer', status: 'completed' },
      { id: 'w8', name: 'Siti Rahayu', roleLabel: 'UI/UX Designer', status: 'completed' },
    ],
    milestones: [
      {
        id: 'ms12',
        title: 'Design System',
        status: 'approved',
        amount: 15000000,
        workerName: 'Siti Rahayu',
        dueDate: '2025-11-05',
      },
      {
        id: 'ms13',
        title: 'Backend APIs',
        status: 'approved',
        amount: 25000000,
        workerName: 'Gunawan H.',
        dueDate: '2025-11-20',
      },
      {
        id: 'ms14',
        title: 'Mobile App Core',
        status: 'approved',
        amount: 30000000,
        workerName: 'Budi Santoso',
        dueDate: '2025-12-15',
      },
      {
        id: 'ms15',
        title: 'Integration & Testing',
        status: 'submitted',
        amount: 15000000,
        workerName: null,
        dueDate: '2026-01-05',
      },
    ],
    transactions: [
      { id: 't10', type: 'escrow_in', amount: 85000000, status: 'completed', date: '2025-10-25' },
      {
        id: 't11',
        type: 'escrow_release',
        amount: 15000000,
        status: 'completed',
        date: '2025-11-08',
      },
      {
        id: 't12',
        type: 'escrow_release',
        amount: 25000000,
        status: 'completed',
        date: '2025-11-22',
      },
      {
        id: 't13',
        type: 'escrow_release',
        amount: 30000000,
        status: 'completed',
        date: '2025-12-18',
      },
    ],
  },
]

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-neutral-500/20 text-neutral-300',
  scoping: 'bg-warning-500/20 text-warning-500',
  brd_generated: 'bg-warning-500/20 text-warning-500',
  brd_approved: 'bg-warning-500/30 text-warning-500',
  prd_generated: 'bg-warning-500/20 text-warning-500',
  prd_approved: 'bg-success-500/20 text-success-500',
  matching: 'bg-warning-500/20 text-warning-500',
  team_forming: 'bg-warning-500/20 text-warning-500',
  matched: 'bg-success-500/20 text-success-500',
  in_progress: 'bg-success-500/20 text-success-500',
  partially_active: 'bg-warning-500/20 text-warning-500',
  review: 'bg-warning-500/20 text-warning-500',
  completed: 'bg-success-500/30 text-success-500',
  cancelled: 'bg-error-500/20 text-error-500',
  disputed: 'bg-error-500/20 text-error-500',
  on_hold: 'bg-neutral-500/20 text-neutral-300',
}

const MILESTONE_BADGE: Record<string, string> = {
  pending: 'bg-neutral-500/20 text-neutral-300',
  in_progress: 'bg-success-500/20 text-success-500',
  submitted: 'bg-warning-500/20 text-warning-500',
  approved: 'bg-success-500/30 text-success-500',
  rejected: 'bg-error-500/20 text-error-500',
  revision_requested: 'bg-warning-500/25 text-warning-500',
}

const CATEGORY_LABELS: Record<string, string> = {
  web_app: 'Web App',
  mobile_app: 'Mobile App',
  ui_ux_design: 'UI/UX Design',
  data_ai: 'Data/AI',
  other_digital: 'Other',
}

function getHealthColor(score: number): string {
  if (score >= 80) return 'text-success-500'
  if (score >= 60) return 'text-warning-500'
  if (score >= 40) return 'text-warning-600'
  return 'text-error-500'
}

function getHealthBg(score: number): string {
  if (score >= 80) return 'bg-success-500'
  if (score >= 60) return 'bg-warning-500'
  if (score >= 40) return 'bg-warning-600'
  return 'bg-error-500'
}

function isOverdue(project: ProjectRow): boolean {
  if (!project.dueDate) return false
  if (project.status === 'completed' || project.status === 'cancelled') return false
  return new Date(project.dueDate) < new Date()
}

function AdminProjectsPage() {
  const { t } = useTranslation('admin')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null)

  const filteredProjects = MOCK_PROJECTS.filter((project) => {
    const matchesSearch =
      !searchQuery ||
      project.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.clientName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = !statusFilter || project.status === statusFilter
    return matchesSearch && matchesStatus
  })

  function formatRp(n: number) {
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
    return `Rp ${n.toLocaleString('id-ID')}`
  }

  function handleReassignTalent(projectId: string, talentId: string) {
    console.log('Reassign worker:', projectId, talentId)
  }

  function handleForceStatus(projectId: string, newStatus: string) {
    console.log('Force status:', projectId, newStatus)
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">
          {t('project_management', 'Project Management')}
        </h1>
        <p className="mt-1 text-sm text-neutral-300">
          {t('project_management_desc', 'Manage and monitor all platform projects')}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_projects', 'Search by project title or client...')}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-3 pr-9 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          >
            <option value="">{t('all_statuses', 'All Statuses')}</option>
            <option value="draft">{t('status_draft', 'Draft')}</option>
            <option value="scoping">{t('status_scoping', 'Scoping')}</option>
            <option value="brd_generated">{t('status_brd_generated', 'BRD Generated')}</option>
            <option value="prd_approved">{t('status_prd_approved', 'PRD Approved')}</option>
            <option value="matching">{t('status_matching', 'Matching')}</option>
            <option value="in_progress">{t('status_in_progress', 'In Progress')}</option>
            <option value="review">{t('status_review', 'Review')}</option>
            <option value="completed">{t('status_completed', 'Completed')}</option>
            <option value="cancelled">{t('status_cancelled', 'Cancelled')}</option>
            <option value="disputed">{t('status_disputed', 'Disputed')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
        </div>
      </div>

      <p className="mb-4 text-sm text-neutral-300">
        {t('showing_projects', 'Showing {{count}} projects', { count: filteredProjects.length })}
      </p>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary-700/60">
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_project', 'Project')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_client', 'Owner')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_status', 'Status')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('health', 'Health')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_team_size', 'Team')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_budget', 'Budget')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_created', 'Created')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-neutral-300">
                    {t('no_projects_found', 'No projects found')}
                  </td>
                </tr>
              ) : (
                filteredProjects.map((project) => (
                  <tr
                    key={project.id}
                    onClick={() => setSelectedProject(project)}
                    className="cursor-pointer transition-colors hover:bg-primary-700/30"
                  >
                    <td className="px-4 py-3">
                      <div className="max-w-[240px]">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-neutral-200">{project.title}</p>
                          {isOverdue(project) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-error-500/20 px-2 py-0.5 text-[10px] font-bold text-error-500">
                              <AlertTriangle className="h-3 w-3" />
                              {t('overdue', 'OVERDUE')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-300">
                          {CATEGORY_LABELS[project.category] ?? project.category}
                        </p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-300">
                      {project.clientName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_BADGE[project.status] ?? STATUS_BADGE.draft,
                        )}
                      >
                        {t(`status_${project.status}`, project.status.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-primary-700">
                          <div
                            className={cn('h-full rounded-full', getHealthBg(project.healthScore))}
                            style={{ width: `${project.healthScore}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            getHealthColor(project.healthScore),
                          )}
                        >
                          {project.healthScore}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-neutral-300">
                        <UsersIcon className="h-3.5 w-3.5 text-neutral-300" />
                        {project.teamSize}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {project.finalPrice ? (
                        <span className="font-semibold text-warning-500">
                          {formatRp(project.finalPrice)}
                        </span>
                      ) : (
                        <span className="text-neutral-300">
                          {formatRp(project.budgetMin)} - {formatRp(project.budgetMax)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-neutral-300">
                        <Calendar className="h-3 w-3" />
                        {formatDateShort(project.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail slide-over */}
      {selectedProject && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-primary-900/60 backdrop-blur-sm"
            onClick={() => setSelectedProject(null)}
            onKeyDown={(e) => e.key === 'Escape' && setSelectedProject(null)}
            tabIndex={-1}
            aria-label="Close panel"
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-primary-700 shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-primary-600/50 px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="truncate text-lg font-semibold text-warning-500">
                    {selectedProject.title}
                  </h2>
                  {isOverdue(selectedProject) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-error-500/20 px-2 py-0.5 text-[10px] font-bold text-error-500">
                      <AlertTriangle className="h-3 w-3" />
                      {t('overdue', 'OVERDUE')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-neutral-300">
                  {CATEGORY_LABELS[selectedProject.category]} | {selectedProject.clientName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProject(null)}
                className="rounded-lg p-2 text-neutral-300 hover:bg-primary-600 hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Project info */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('project_info', 'Project Info')}
                  </h3>
                  <p className="mb-3 text-sm text-neutral-300">{selectedProject.description}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_status', 'Status')}</p>
                      <span
                        className={cn(
                          'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_BADGE[selectedProject.status],
                        )}
                      >
                        {t(`status_${selectedProject.status}`, selectedProject.status)}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('health', 'Health')}</p>
                      <span
                        className={cn(
                          'mt-1 inline-flex items-center gap-1 text-sm font-bold',
                          getHealthColor(selectedProject.healthScore),
                        )}
                      >
                        {selectedProject.healthScore}/100
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_budget', 'Budget')}</p>
                      <p className="mt-1 text-sm font-semibold text-warning-500">
                        {selectedProject.finalPrice
                          ? formatRp(selectedProject.finalPrice)
                          : `${formatRp(selectedProject.budgetMin)} - ${formatRp(selectedProject.budgetMax)}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">
                        {t('platform_fee', 'Platform Fee')}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-neutral-300">
                        {selectedProject.platformFee ? formatRp(selectedProject.platformFee) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('timeline', 'Timeline')}</p>
                      <p className="mt-1 text-sm text-neutral-300">
                        {selectedProject.estimatedDays} {t('days_unit', 'days')}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('due_date', 'Due Date')}</p>
                      <p
                        className={cn(
                          'mt-1 text-sm',
                          selectedProject.dueDate && isOverdue(selectedProject)
                            ? 'text-error-500 font-semibold'
                            : 'text-neutral-300',
                        )}
                      >
                        {selectedProject.dueDate ? formatDateShort(selectedProject.dueDate) : '-'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Team */}
                {selectedProject.workers.length > 0 && (
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                      <UsersIcon className="h-4 w-4" />
                      {t('team', 'Team')} ({selectedProject.workers.length})
                    </h3>
                    <div className="space-y-2">
                      {selectedProject.workers.map((worker) => (
                        <div
                          key={worker.id}
                          className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-800 text-xs font-semibold text-warning-500">
                              {worker.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .substring(0, 2)
                                .toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-neutral-200">{worker.name}</p>
                              <p className="text-xs text-neutral-300">{worker.roleLabel}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                worker.status === 'active'
                                  ? 'bg-success-500/20 text-success-500'
                                  : worker.status === 'completed'
                                    ? 'bg-success-500/30 text-success-500'
                                    : 'bg-error-500/20 text-error-500',
                              )}
                            >
                              {worker.status}
                            </span>
                            {worker.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => handleReassignTalent(selectedProject.id, worker.id)}
                                className="rounded p-1 text-neutral-300 hover:bg-primary-600 hover:text-warning-500"
                                title={t('reassign', 'Reassign')}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Milestones */}
                {selectedProject.milestones.length > 0 && (
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                      <Milestone className="h-4 w-4" />
                      {t('milestones', 'Milestones')} ({selectedProject.milestones.length})
                    </h3>
                    <div className="space-y-2">
                      {selectedProject.milestones.map((ms) => (
                        <div
                          key={ms.id}
                          className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-neutral-200">
                              {ms.title}
                            </p>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-300">
                              {ms.workerName && <span>{ms.workerName}</span>}
                              <span>
                                {t('due', 'Due')}: {ms.dueDate}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-warning-500">
                              {formatRp(ms.amount)}
                            </span>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                MILESTONE_BADGE[ms.status],
                              )}
                            >
                              {ms.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transactions */}
                {selectedProject.transactions.length > 0 && (
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                      <DollarSign className="h-4 w-4" />
                      {t('transactions', 'Transactions')} ({selectedProject.transactions.length})
                    </h3>
                    <div className="space-y-2">
                      {selectedProject.transactions.map((txn) => (
                        <div
                          key={txn.id}
                          className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                        >
                          <div>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                txn.type.includes('release')
                                  ? 'bg-success-500/20 text-success-500'
                                  : txn.type.includes('refund')
                                    ? 'bg-error-500/20 text-error-500'
                                    : 'bg-warning-500/20 text-warning-500',
                              )}
                            >
                              {txn.type.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-warning-500">
                              {formatRp(txn.amount)}
                            </span>
                            <span className="text-xs text-neutral-300">{txn.date}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin actions */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('admin_actions', 'Admin Actions')}
                  </h3>
                  <div className="space-y-3">
                    {/* Force status change */}
                    <div>
                      <p className="mb-2 text-xs text-neutral-300">
                        {t('force_status', 'Force Status Change')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {['in_progress', 'on_hold', 'cancelled', 'completed'].map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => handleForceStatus(selectedProject.id, st)}
                            disabled={selectedProject.status === st}
                            className={cn(
                              'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                              selectedProject.status === st
                                ? 'cursor-not-allowed bg-neutral-500/20 text-neutral-300'
                                : st === 'cancelled'
                                  ? 'border border-error-500/50 text-error-500 hover:bg-error-500/10'
                                  : st === 'completed'
                                    ? 'bg-success-500 text-primary-800 hover:bg-success-600'
                                    : 'border border-neutral-600/50 text-neutral-300 hover:bg-primary-700',
                            )}
                          >
                            {t(`status_${st}`, st.replace(/_/g, ' '))}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Adjust pricing */}
                    <div>
                      <p className="mb-2 text-xs text-neutral-300">
                        {t('adjust_pricing', 'Adjust Pricing')}
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder={t('new_price', 'New price (Rp)')}
                          className="flex-1 rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none"
                        />
                        <button
                          type="button"
                          className="rounded-lg bg-warning-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-warning-600"
                        >
                          {t('update', 'Update')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
