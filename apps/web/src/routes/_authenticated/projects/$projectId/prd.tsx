import { normalizePrdContent } from '@kerjacus/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock,
  Cpu,
  Database,
  Download,
  FileText,
  Globe,
  Loader2,
  MessageSquare,
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
import { PrdDocumentBody } from '@/components/project/prd/prd-document-body'
import { LanguageChoice } from '@/components/ui/language-choice'
import {
  type DocLanguage,
  useGeneratePrd,
  useProject,
  useProjectBrd,
  useProjectPrd,
  useTransitionProject,
} from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { localizeErrorCode } from '@/lib/error-messages'
import { cn, formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
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

const _TECH_ICON_MAP: Record<string, React.ReactNode> = {
  frontend: <Globe className="h-5 w-5" />,
  backend: <Server className="h-5 w-5" />,
  database: <Database className="h-5 w-5" />,
  mobile: <Smartphone className="h-5 w-5" />,
  devops: <Settings className="h-5 w-5" />,
  design: <Palette className="h-5 w-5" />,
  data: <BarChart3 className="h-5 w-5" />,
  ai: <Cpu className="h-5 w-5" />,
}

function PrdViewerPage() {
  const { t } = useTranslation('document')
  const role = useAuthStore((s) => s.user?.role)
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: prd, isLoading: prdLoading } = useProjectPrd(projectId)
  const { data: project } = useProject(projectId)
  const { data: brd } = useProjectBrd(projectId)
  const transitionProject = useTransitionProject()
  const generatePrd = useGeneratePrd()
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const [revisionMode, setRevisionMode] = useState(false)
  const [revisionText, setRevisionText] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [genLanguage, setGenLanguage] = useState<DocLanguage>('id')

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
            <div className="mt-6 flex flex-col items-center gap-2">
              <span className="text-xs font-medium text-on-surface-muted">
                {t('document_language')}
              </span>
              <LanguageChoice
                value={genLanguage}
                onChange={setGenLanguage}
                disabled={generatePrd.isPending}
              />
            </div>
            <button
              type="button"
              disabled={generatePrd.isPending || !brd}
              onClick={async () => {
                try {
                  await generatePrd.mutateAsync({
                    projectId,
                    brdContent: brd?.content ?? {},
                    language: genLanguage,
                  })
                  addToast('success', t('prd_generated_success'))
                } catch (err) {
                  // Surface the specific reason, e.g. the daily free limit.
                  addToast('error', err instanceof Error ? err.message : t('prd_generated_error'))
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

  // Accepts either casing; the AI service emits snake_case.
  const displayContent = normalizePrdContent(prd.content)

  const statusInfo = STATUS_BADGE[prd?.status ?? 'draft'] ?? STATUS_BADGE.draft
  // Download and the clean preview unlock only once the PRD is paid.
  const isUnlocked = !!prd?.paidAt
  // Assigned talents read the PRD as their brief; owner actions are hidden.
  const isOwnerViewer = role !== 'talent'
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
    // Finishing with the PRD alone requires paying for it first.
    if (!prd?.paidAt) {
      navigate({
        to: '/projects/$projectId/checkout',
        params: { projectId },
        search: { type: 'prd' },
      })
      return
    }
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

  function handleProceedDevelopment() {
    // Development starts with escrow funding: the ESC- payment webhook is what
    // transitions the project to matching, never a free transition from here.
    navigate({
      to: '/projects/$projectId/checkout',
      params: { projectId },
      search: { type: 'escrow' },
    })
  }

  async function handleSendRevision() {
    if (!revisionText.trim()) return
    setActionLoading('revision')
    try {
      const res = await fetch(apiUrl(`/api/v1/projects/${projectId}/prd/revision`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Service expects description, not content.
        body: JSON.stringify({ description: revisionText.trim() }),
      })
      // At the revision cap the owner pays to unlock more.
      if (res.status === 402) {
        setRevisionMode(false)
        navigate({
          to: '/projects/$projectId/checkout',
          params: { projectId },
          search: { type: 'prd' },
        })
        return
      }
      // Other failures (e.g. the paid revision cap) carry a specific code.
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { code?: string }
        } | null
        throw new Error(localizeErrorCode(data?.error?.code))
      }
      setRevisionMode(false)
      setRevisionText('')
      // The revision regenerates the PRD, so pull the fresh content.
      await queryClient.invalidateQueries({ queryKey: ['project-prd', projectId] })
      addToast('success', t('revision_requested_success'))
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('revision_request_error'))
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
            {isUnlocked && isOwnerViewer && (
              <button
                type="button"
                onClick={() =>
                  window.open(apiUrl(`/api/v1/projects/${projectId}/prd/pdf`), '_blank')
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/20 bg-surface-bright px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-surface-container"
              >
                <Download className="h-3.5 w-3.5" />
                {t('download_pdf')}
              </button>
            )}
            {!isUnlocked && isOwnerViewer && (
              <Link
                to="/projects/$projectId/checkout"
                params={{ projectId }}
                search={{ type: 'prd' }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
              >
                <Wallet className="h-3.5 w-3.5" />
                {t('unlock_download')}
              </Link>
            )}
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

        <PrdDocumentBody content={displayContent} isUnlocked={isUnlocked} />
        {/* Revision input */}
        {isOwnerViewer && revisionMode && (
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

        {/* Owner-only decision controls; talents read the PRD as their brief. */}
        {isOwnerViewer && (
          <>
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
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
              >
                <ArrowRight className="h-4 w-4" />
                {t('proceed_development')}
              </button>
            </div>

            {/* Decision info */}
            <div className="mt-6 rounded-lg border border-outline-dim/20 bg-surface-container p-4">
              <h3 className="mb-2 text-sm font-semibold text-primary-600">
                {t('prd_decision_title')}
              </h3>
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
          </>
        )}
      </div>
    </div>
  )
}
