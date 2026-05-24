import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  Database,
  FileText,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  MessageSquare,
  Package,
  Palette,
  Send,
  Server,
  Settings,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useGeneratePrd,
  useProject,
  useProjectBrd,
  useProjectPrd,
  useTransitionProject,
} from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/prd')({
  component: PrdViewerPage,
})

const STATUS_BADGE: Record<string, { color: string; labelKey: string }> = {
  draft: { color: 'bg-surface-container text-on-surface-muted', labelKey: 'status_draft' },
  review: {
    color: 'bg-warning-500/10 text-warning-600',
    labelKey: 'status_review',
  },
  approved: {
    color: 'bg-success-500/10 text-success-600',
    labelKey: 'status_approved',
  },
  paid: { color: 'bg-primary-600/15 text-primary-600', labelKey: 'status_paid' },
}

const TECH_ICON_MAP: Record<string, React.ReactNode> = {
  frontend: <Globe className="h-5 w-5" />,
  backend: <Server className="h-5 w-5" />,
  database: <Database className="h-5 w-5" />,
  mobile: <Smartphone className="h-5 w-5" />,
  devops: <Settings className="h-5 w-5" />,
  design: <Palette className="h-5 w-5" />,
  data: <BarChart3 className="h-5 w-5" />,
  ai: <Cpu className="h-5 w-5" />,
}

type TechStackItem = {
  category: string
  name: string
  description: string
  recommended?: boolean
}

type ApiEndpoint = {
  method: string
  path: string
  description: string
}

type DbTable = {
  name: string
  description: string
  columns: number
}

type TeamMember = {
  role: string
  skills: string[]
  estimatedHours: number
}

type WorkPackageItem = {
  name: string
  requiredSkills: string[]
  estimatedHours: number
  amount: number
  dependencies: string[]
}

type SprintItem = {
  name: string
  duration: string
  milestones: string[]
}

type DependencyItem = {
  from: string
  to: string
  type: string
}

type PrdContent = {
  techStack?: TechStackItem[]
  architecture?: string
  apiDesign?: ApiEndpoint[]
  databaseSchema?: DbTable[]
  teamComposition?: TeamMember[]
  workPackages?: WorkPackageItem[]
  sprintPlan?: SprintItem[]
  dependencyGraph?: DependencyItem[]
  totalCost?: number
  teamSize?: number
  totalEstimatedHours?: number
}

function PrdViewerPage() {
  const { t } = useTranslation('document')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: prd, isLoading: prdLoading } = useProjectPrd(projectId)
  const { data: project } = useProject(projectId)
  const { data: brd } = useProjectBrd(projectId)
  const transitionProject = useTransitionProject()
  const generatePrd = useGeneratePrd()
  const { addToast } = useToastStore()
  const [revisionMode, setRevisionMode] = useState(false)
  const [revisionText, setRevisionText] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  if (prdLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          <p className="text-sm text-on-surface-muted">{t('prd_loading')}</p>
        </div>
      </div>
    )
  }

  const hasPrd = !!prd

  if (!hasPrd) {
    return (
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-primary-600">{t('prd_title')}</h1>
            {project && <p className="mt-1 text-sm text-on-surface-muted">{project.title}</p>}
          </div>
          <div className="flex flex-col items-center justify-center rounded-2xl border border-outline-dim/20 bg-surface-bright py-16 px-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container">
              <FileText className="h-8 w-8 text-on-surface-muted" />
            </div>
            <h3 className="text-lg font-semibold text-primary-600">{t('prd_not_created')}</h3>
            <p className="mt-2 max-w-md text-sm text-on-surface-muted">
              {t('prd_not_created_desc')}
            </p>
            <button
              type="button"
              disabled={generatePrd.isPending || !brd}
              onClick={async () => {
                try {
                  await generatePrd.mutateAsync({
                    projectId,
                    brdContent: brd?.content ?? {},
                  })
                  addToast('success', t('prd_generated_success'))
                } catch {
                  addToast('error', t('prd_generated_error'))
                }
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {generatePrd.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generatePrd.isPending ? t('prd_generating') : t('generate_prd')}
            </button>
            {!brd && <p className="mt-3 text-xs text-on-surface-muted">{t('prd_needs_brd')}</p>}
          </div>
        </div>
      </div>
    )
  }

  const content: PrdContent = (prd.content ?? {}) as PrdContent
  const displayContent: PrdContent = {
    techStack: content.techStack ?? [],
    architecture: content.architecture ?? '',
    apiDesign: content.apiDesign ?? [],
    databaseSchema: content.databaseSchema ?? [],
    teamComposition: content.teamComposition ?? [],
    workPackages: content.workPackages ?? [],
    sprintPlan: content.sprintPlan ?? [],
    dependencyGraph: content.dependencyGraph ?? [],
    totalCost: content.totalCost ?? 0,
    teamSize: content.teamSize ?? 0,
    totalEstimatedHours: content.totalEstimatedHours ?? 0,
  }

  const statusInfo = STATUS_BADGE[prd?.status ?? 'draft'] ?? STATUS_BADGE.draft

  const METHOD_COLORS: Record<string, string> = {
    GET: 'bg-success-500/10 text-success-600',
    POST: 'bg-primary-600/15 text-primary-600',
    PUT: 'bg-warning-500/10 text-warning-600',
    PATCH: 'bg-warning-500/10 text-warning-600',
    DELETE: 'bg-error-500/10 text-error-600',
  }

  async function handleApprove() {
    setActionLoading('approve')
    try {
      await transitionProject.mutateAsync({
        projectId,
        status: 'prd_approved',
      })
    } catch {
      // Error handled by mutation state
    } finally {
      setActionLoading(null)
    }
  }

  async function handleBuyPrd() {
    setActionLoading('buy')
    try {
      await transitionProject.mutateAsync({
        projectId,
        status: 'prd_purchased',
      })
      navigate({ to: '/projects' })
    } catch {
      // Error handled by mutation state
    } finally {
      setActionLoading(null)
    }
  }

  async function handleProceedDevelopment() {
    setActionLoading('proceed')
    try {
      await transitionProject.mutateAsync({
        projectId,
        status: 'matching',
      })
      navigate({ to: '/projects/$projectId', params: { projectId } })
    } catch {
      // Error handled by mutation state
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSendRevision() {
    if (!revisionText.trim()) return
    setActionLoading('revision')
    try {
      await fetch(apiUrl(`/api/v1/projects/${projectId}/prd/revision`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: revisionText.trim() }),
      })
      setRevisionMode(false)
      setRevisionText('')
    } catch {
      // Error state could be shown
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-primary-600">{t('prd_title')}</h1>
            {project && <p className="mt-1 text-sm text-on-surface-muted">{project.title}</p>}
          </div>
          <div className="flex items-center gap-3">
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', statusInfo.color)}>
              {t(statusInfo.labelKey)}
            </span>
            <span className="text-xs text-on-surface-muted">
              {t('version')} {prd?.version ?? 1}
            </span>
          </div>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-primary-500/20 bg-primary-600/5 p-5 text-center">
            <Wallet className="mx-auto mb-2 h-5 w-5 text-primary-500" />
            <p className="text-xs font-medium text-primary-600/70">{t('total_cost')}</p>
            <p className="mt-1 text-lg font-semibold text-primary-600">
              {formatCurrency(displayContent.totalCost ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-success-500/20 bg-success-500/5 p-5 text-center">
            <Users className="mx-auto mb-2 h-5 w-5 text-success-600" />
            <p className="text-xs font-medium text-success-600/70">{t('team_size')}</p>
            <p className="mt-1 text-lg font-semibold text-success-600">{displayContent.teamSize}</p>
            <p className="text-xs text-success-600/60">{t('talents')}</p>
          </div>
          <div className="rounded-xl border border-accent-coral-500/20 bg-accent-coral-500/5 p-5 text-center">
            <Clock className="mx-auto mb-2 h-5 w-5 text-accent-coral-600" />
            <p className="text-xs font-medium text-accent-coral-600/70">{t('estimated_hours')}</p>
            <p className="mt-1 text-lg font-semibold text-accent-coral-600">
              {displayContent.totalEstimatedHours}
            </p>
            <p className="text-xs text-accent-coral-600/60">{t('hours')}</p>
          </div>
        </div>

        {/* PRD sections */}
        <div className="space-y-3">
          {/* Tech Stack */}
          <PrdSection icon={<Layers className="h-4 w-4" />} title={t('tech_stack')} defaultOpen>
            <div className="grid gap-3 sm:grid-cols-2">
              {displayContent.techStack?.map((tech) => {
                const icon = TECH_ICON_MAP[tech.category] ?? <Code2 className="h-5 w-5" />
                return (
                  <div
                    key={tech.name}
                    className="flex items-start gap-3 rounded-lg border border-outline-dim/10 bg-surface-bright p-4"
                  >
                    <span className="mt-0.5 text-on-surface-muted">{icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-primary-600">{tech.name}</h4>
                        {tech.recommended && (
                          <span className="rounded bg-success-500/10 px-1.5 py-0.5 text-[10px] font-medium text-success-600">
                            {t('recommended')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-on-surface-muted">{tech.description}</p>
                      <span className="mt-1 inline-block rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-medium text-on-surface-muted">
                        {t(`category_${tech.category}`)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </PrdSection>

          {/* Architecture */}
          <PrdSection icon={<Server className="h-4 w-4" />} title={t('architecture')}>
            <p className="text-sm leading-relaxed text-on-surface-muted">
              {displayContent.architecture}
            </p>
          </PrdSection>

          {/* API Design */}
          <PrdSection icon={<Code2 className="h-4 w-4" />} title={t('api_design')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-dim/20 text-left">
                    <th className="pb-2 pr-4 text-xs font-semibold text-on-surface-muted">
                      {t('method')}
                    </th>
                    <th className="pb-2 pr-4 text-xs font-semibold text-on-surface-muted">
                      {t('path')}
                    </th>
                    <th className="pb-2 text-xs font-semibold text-on-surface-muted">
                      {t('description')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-dim/10">
                  {displayContent.apiDesign?.map((ep) => (
                    <tr key={`${ep.method}-${ep.path}`}>
                      <td className="py-2.5 pr-4">
                        <span
                          className={cn(
                            'inline-block rounded px-2 py-0.5 text-xs font-semibold',
                            METHOD_COLORS[ep.method] ??
                              'bg-surface-container text-on-surface-muted',
                          )}
                        >
                          {ep.method}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <code className="text-xs text-primary-600">{ep.path}</code>
                      </td>
                      <td className="py-2.5 text-xs text-on-surface-muted">{ep.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PrdSection>

          {/* Database Schema */}
          <PrdSection icon={<Database className="h-4 w-4" />} title={t('database_schema')}>
            <div className="grid gap-2 sm:grid-cols-2">
              {displayContent.databaseSchema?.map((table) => (
                <div
                  key={table.name}
                  className="flex items-center gap-3 rounded-lg border border-outline-dim/10 bg-surface-bright p-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-coral-500/10">
                    <Database className="h-4 w-4 text-accent-coral-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-primary-600">{table.name}</h4>
                    <p className="truncate text-xs text-on-surface-muted">{table.description}</p>
                  </div>
                  <span className="shrink-0 rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-medium text-on-surface-muted">
                    {table.columns} cols
                  </span>
                </div>
              ))}
            </div>
          </PrdSection>

          {/* Team Composition */}
          <PrdSection
            icon={<Users className="h-4 w-4" />}
            title={t('team_composition')}
            defaultOpen
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {displayContent.teamComposition?.map((member) => (
                <div
                  key={member.role}
                  className="rounded-xl border border-outline-dim/20 bg-surface-bright p-4"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary-600/10">
                    <Users className="h-5 w-5 text-primary-500" />
                  </div>
                  <h4 className="text-sm font-semibold text-primary-600">{member.role}</h4>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {member.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-medium text-on-surface-muted"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-on-surface-muted">
                    <Clock className="h-3 w-3" />
                    {member.estimatedHours} {t('hours')}
                  </div>
                </div>
              ))}
            </div>
          </PrdSection>

          {/* Work Packages */}
          <PrdSection icon={<Package className="h-4 w-4" />} title={t('work_packages')} defaultOpen>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-dim/20 text-left">
                    <th className="pb-2 pr-4 text-xs font-semibold text-on-surface-muted">
                      {t('package_name')}
                    </th>
                    <th className="pb-2 pr-4 text-xs font-semibold text-on-surface-muted">
                      {t('required_skills')}
                    </th>
                    <th className="pb-2 pr-4 text-xs font-semibold text-on-surface-muted text-right">
                      {t('estimated_hours')}
                    </th>
                    <th className="pb-2 pr-4 text-xs font-semibold text-on-surface-muted text-right">
                      {t('amount')}
                    </th>
                    <th className="pb-2 text-xs font-semibold text-on-surface-muted">
                      {t('dependency')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-dim/10">
                  {displayContent.workPackages?.map((wp) => (
                    <tr key={wp.name}>
                      <td className="py-3 pr-4">
                        <span className="text-sm font-medium text-primary-600">{wp.name}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {wp.requiredSkills.map((skill) => (
                            <span
                              key={skill}
                              className="rounded-full bg-primary-600/10 px-2 py-0.5 text-[10px] font-medium text-primary-600"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right text-sm text-on-surface-muted">
                        {wp.estimatedHours}h
                      </td>
                      <td className="py-3 pr-4 text-right text-sm font-medium text-primary-600">
                        {formatCurrency(wp.amount)}
                      </td>
                      <td className="py-3">
                        {wp.dependencies.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {wp.dependencies.map((dep) => (
                              <span
                                key={dep}
                                className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] text-on-surface-muted"
                              >
                                {dep}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-on-surface-muted">
                            {t('no_dependency')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-outline-dim/20">
                    <td className="pt-3 pr-4 text-sm font-semibold text-primary-600">
                      {t('total_cost')}
                    </td>
                    <td className="pt-3 pr-4" />
                    <td className="pt-3 pr-4 text-right text-sm font-semibold text-primary-600">
                      {displayContent.workPackages?.reduce((sum, wp) => sum + wp.estimatedHours, 0)}
                      h
                    </td>
                    <td className="pt-3 pr-4 text-right text-sm font-semibold text-primary-600">
                      {formatCurrency(
                        displayContent.workPackages?.reduce((sum, wp) => sum + wp.amount, 0) ?? 0,
                      )}
                    </td>
                    <td className="pt-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </PrdSection>

          {/* Sprint Plan */}
          <PrdSection icon={<Calendar className="h-4 w-4" />} title={t('sprint_plan')}>
            <div className="space-y-4">
              {displayContent.sprintPlan?.map((sprint, sprintIndex) => (
                <div key={sprint.name} className="relative pl-8">
                  {/* Timeline dot and line */}
                  <div className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary-600/100 text-[10px] font-bold text-white">
                    {sprintIndex + 1}
                  </div>
                  {sprintIndex < (displayContent.sprintPlan?.length ?? 0) - 1 && (
                    <div className="absolute left-[11px] top-6 h-full w-0.5 bg-primary-600/15" />
                  )}
                  <div className="rounded-lg border border-outline-dim/10 bg-surface-bright p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-primary-600">{sprint.name}</h4>
                      <span className="rounded-full bg-primary-600/10 px-2 py-0.5 text-[10px] font-medium text-primary-600">
                        {sprint.duration}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {sprint.milestones.map((milestone) => (
                        <li
                          key={milestone}
                          className="flex items-start gap-2 text-xs text-on-surface-muted"
                        >
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-success-500" />
                          {milestone}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </PrdSection>

          {/* Dependency Graph */}
          <PrdSection icon={<GitBranch className="h-4 w-4" />} title={t('dependencies')}>
            <div className="space-y-2">
              {displayContent.dependencyGraph?.map((dep) => (
                <div
                  key={`${dep.from}-${dep.to}`}
                  className="flex items-center gap-3 rounded-lg border border-outline-dim/10 bg-surface-bright px-4 py-3"
                >
                  <span className="rounded bg-primary-600/10 px-2 py-1 text-xs font-medium text-primary-600">
                    {dep.from}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-on-surface-muted" />
                  <span className="rounded bg-success-500/10 px-2 py-1 text-xs font-medium text-success-600">
                    {dep.to}
                  </span>
                  <span className="ml-auto text-[10px] text-on-surface-muted">
                    {dep.type.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          </PrdSection>
        </div>

        {/* Revision input */}
        {revisionMode && (
          <div className="mt-6 rounded-xl border border-outline-dim/20 bg-surface-bright p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-primary-600">{t('request_revision')}</h3>
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded p-1 text-on-surface-muted hover:text-on-surface-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              placeholder={t('revision_placeholder')}
              className="w-full resize-none rounded-lg border border-outline-dim/20 px-3 py-2.5 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-surface-bright"
              >
                {t('cancel_revision')}
              </button>
              <button
                type="button"
                onClick={handleSendRevision}
                disabled={!revisionText.trim() || actionLoading === 'revision'}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {actionLoading === 'revision' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t('send_revision')}
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-outline-dim/20 pt-6">
          <button
            type="button"
            onClick={handleApprove}
            disabled={actionLoading === 'approve'}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {actionLoading === 'approve' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t('approve_prd')}
          </button>
          <button
            type="button"
            onClick={() => setRevisionMode(true)}
            disabled={revisionMode}
            className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 bg-surface-bright px-5 py-2.5 text-sm font-medium text-primary-600 hover:bg-surface-bright disabled:opacity-50"
          >
            <MessageSquare className="h-4 w-4" />
            {t('request_revision')}
          </button>
          <button
            type="button"
            onClick={handleBuyPrd}
            disabled={actionLoading === 'buy'}
            className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/20 bg-surface-bright px-5 py-2.5 text-sm font-medium text-primary-600 hover:bg-surface-bright disabled:opacity-50"
          >
            {actionLoading === 'buy' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
            {t('buy_prd_only')}
          </button>
          <button
            type="button"
            onClick={handleProceedDevelopment}
            disabled={actionLoading === 'proceed'}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {actionLoading === 'proceed' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {t('proceed_development')}
          </button>
        </div>

        {/* Decision info */}
        <div className="mt-6 rounded-lg border border-outline-dim/20 bg-surface-container p-4">
          <h3 className="mb-2 text-sm font-semibold text-primary-600">{t('prd_decision_title')}</h3>
          <ul className="space-y-2 text-sm text-on-surface-muted">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-on-surface-muted" />
              {t('prd_option_b')}
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-on-surface-muted" />
              {t('prd_option_c')}
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function PrdSection({
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl border border-outline-dim/20 bg-surface-bright">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
        aria-expanded={isOpen}
      >
        <span className="text-on-surface-muted">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-primary-600">{title}</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-on-surface-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-on-surface-muted" />
        )}
      </button>
      {isOpen && <div className="border-t border-outline-dim/10 px-5 py-4">{children}</div>}
    </div>
  )
}
