import { normalizeBrdContent, type BrdContent as SharedBrdContent } from '@kerjacus/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  ShoppingCart,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BrdDocumentBody,
  type BrdTemplateScore,
  BrdTemplateScorePanel,
} from '@/components/project/brd/brd-document-body'
import {
  useGeneratePrd,
  useProject,
  useProjectBrd,
  useTransitionProject,
} from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { localizeErrorCode } from '@/lib/error-messages'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/brd')({
  component: BrdViewerPage,
})

const STATUS_BADGE: Record<string, { color: string; labelKey: string }> = {
  draft: {
    color: 'bg-accent-cream-500/10 text-brand-text border border-accent-cream-500/20',
    labelKey: 'status_draft',
  },
  review: {
    color: 'bg-accent-cream-500/15 text-brand-text border border-brand-accent/20',
    labelKey: 'status_review',
  },
  approved: {
    color: 'bg-brand-accent/15 text-success-600 border border-success-500/30',
    labelKey: 'status_approved',
  },
  paid: {
    color: 'bg-accent-coral-500/15 text-accent-coral-600 border border-accent-coral-500/30',
    labelKey: 'status_paid',
  },
}

// The document fields come from the shared normaliser, so the preview and
// the PDF cannot disagree about what a BRD contains. templateScore is the
// one addition: revision guidance, shown on screen, absent from the PDF.
type BrdContent = SharedBrdContent & {
  templateScore?: BrdTemplateScore
}

function BrdViewerPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: brd, isLoading: brdLoading } = useProjectBrd(projectId)
  const { data: project } = useProject(projectId)
  const transitionProject = useTransitionProject()
  const generatePrd = useGeneratePrd()
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const [revisionMode, setRevisionMode] = useState(false)
  const [revisionText, setRevisionText] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  if (brdLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-surface">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-success-600" />
          <p className="text-sm text-on-surface-muted">{t('brd_loading')}</p>
        </div>
      </div>
    )
  }

  const hasBrd = !!brd

  if (!hasBrd) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-surface p-6">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/10">
            <FileText className="h-8 w-8 text-brand-text" />
          </div>
          <h2 className="text-xl font-semibold text-brand-text">{t('brd_not_created')}</h2>
          <p className="mt-2 text-sm text-on-surface-muted">{t('brd_not_created_desc')}</p>
          <Link
            to="/projects/$projectId/scoping"
            params={{ projectId }}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
            {t('go_to_scoping')}
          </Link>
        </div>
      </div>
    )
  }

  const raw = (brd.content ?? {}) as Record<string, unknown>
  // Shared with the PDF renderer. These were two copies that drifted, and the
  // owner read a different document on screen than the one they paid for.
  const content: BrdContent = {
    ...normalizeBrdContent(raw),
    // Preview-only: the score is guidance for revising, not part of the deliverable.
    templateScore: (raw.template_score ?? raw.templateScore) as BrdTemplateScore | undefined,
  }
  const brdStatus = brd.status
  const brdVersion = brd.version
  const statusInfo = STATUS_BADGE[brdStatus] ?? STATUS_BADGE.draft
  // Download and the clean preview unlock only once the BRD is paid.
  const isUnlocked = !!brd.paidAt
  // The PRD inherits the language the owner picked for the BRD.
  const brdLang: 'id' | 'en' = raw.language === 'en' ? 'en' : 'id'

  const displayContent: BrdContent = content

  async function handleBuyBrd() {
    // Finishing with the BRD alone requires paying for it first.
    if (!brd?.paidAt) {
      navigate({
        to: '/projects/$projectId/checkout',
        params: { projectId },
        search: { type: 'brd' },
      })
      return
    }
    setActionLoading('buy')
    try {
      await transitionProject.mutateAsync({
        projectId,
        status: 'brd_purchased',
      })
      addToast('success', t('brd_purchased_success'))
      navigate({ to: '/projects' })
    } catch {
      addToast('error', t('brd_purchased_error'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleContinuePrd() {
    setActionLoading('prd')
    try {
      await generatePrd.mutateAsync({ projectId, language: brdLang })
      addToast('success', t('prd_generation_started'))
      navigate({ to: '/projects/$projectId/prd', params: { projectId } })
    } catch {
      addToast('error', t('prd_generation_error'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleContinueDevelop() {
    setActionLoading('develop')
    try {
      await generatePrd.mutateAsync({ projectId, language: brdLang })
      addToast('success', t('prd_generation_started'))
      navigate({ to: '/projects/$projectId/prd', params: { projectId } })
    } catch {
      addToast('error', t('prd_generation_error'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSendRevision() {
    if (!revisionText.trim()) return
    setActionLoading('revision')
    try {
      const res = await fetch(apiUrl(`/api/v1/projects/${projectId}/brd/revision`), {
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
          search: { type: 'brd' },
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
      // The revision regenerates the BRD, so pull the fresh content.
      await queryClient.invalidateQueries({ queryKey: ['project-brd', projectId] })
      addToast('success', t('revision_requested_success'))
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('revision_request_error'))
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-text tracking-tight">{t('brd_title')}</h1>
            {project && <p className="mt-1 text-sm text-on-surface-muted">{project.title}</p>}
          </div>
          <div className="flex items-center gap-3">
            {isUnlocked ? (
              <button
                type="button"
                onClick={() =>
                  window.open(apiUrl(`/api/v1/projects/${projectId}/brd/pdf`), '_blank')
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90"
              >
                <Download className="h-3.5 w-3.5" />
                {t('download_pdf')}
              </button>
            ) : (
              <Link
                to="/projects/$projectId/checkout"
                params={{ projectId }}
                search={{ type: 'brd' }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90"
              >
                <Wallet className="h-3.5 w-3.5" />
                {t('brd_unlock_button')}
              </Link>
            )}
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', statusInfo.color)}>
              {t(statusInfo.labelKey)}
            </span>
            <span className="text-xs text-on-surface-muted">
              {t('version')} {brdVersion}
            </span>
          </div>
        </div>

        {/* Template completeness score */}
        {displayContent.templateScore && (
          <BrdTemplateScorePanel score={displayContent.templateScore} />
        )}

        <BrdDocumentBody content={displayContent} isUnlocked={isUnlocked} />
        {/* Revision input. The first two revisions are free before payment;
            handleSendRevision routes to checkout on the 402 at the cap. */}
        {revisionMode && (
          <div className="mt-6 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-brand-text">{t('request_revision')}</h3>
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded p-1 text-on-surface-muted hover:text-brand-text transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              placeholder={t('revision_placeholder')}
              className="w-full resize-none rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-brand-text placeholder:text-on-surface-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-brand-text/70 hover:bg-surface-container transition-colors"
              >
                {t('cancel_revision')}
              </button>
              <button
                type="button"
                onClick={handleSendRevision}
                disabled={!revisionText.trim() || actionLoading === 'revision'}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
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

        {/* Revision button: reachable unpaid so the free revisions are usable */}
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-outline-dim/20 pt-6">
          <button
            type="button"
            onClick={() => setRevisionMode(true)}
            disabled={revisionMode}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-accent/20 px-5 py-2.5 text-sm font-medium text-brand-text hover:bg-surface-bright/50 disabled:opacity-50 transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            {t('request_revision')}
          </button>
        </div>

        {/* Owner decisions after previewing the BRD: buy it only, continue to
            the (free) PRD, or fund development. Shown before payment too - the
            PRD is a separate free generation, not gated behind buying the BRD. */}
        <div className="mt-8">
          <h3 className="mb-4 text-lg font-bold text-brand-text">{t('brd_decision_title')}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Option A: Buy BRD Only */}
            <div className="rounded-2xl bg-surface-bright border border-outline-dim/20 p-5 flex flex-col">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-accent/10">
                <ShoppingCart className="h-5 w-5 text-brand-text" />
              </div>
              <h4 className="text-sm font-bold text-brand-text">{t('brd_decision_buy_title')}</h4>
              <p className="mt-1 flex-1 text-xs text-on-surface-muted">
                {t('brd_decision_buy_desc')}
              </p>
              <button
                type="button"
                onClick={handleBuyBrd}
                disabled={actionLoading === 'buy'}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-coral-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-coral-500/90 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'buy' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4" />
                )}
                {t('buy_brd_only')}
              </button>
            </div>

            {/* Option B: Continue to PRD */}
            <div className="rounded-2xl bg-surface-bright border border-brand-accent/30 p-5 flex flex-col ring-1 ring-brand-accent/10">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-cream-500/20">
                <FileText className="h-5 w-5 text-brand-text" />
              </div>
              <h4 className="text-sm font-bold text-brand-text">{t('brd_decision_prd_title')}</h4>
              <p className="mt-1 flex-1 text-xs text-on-surface-muted">
                {t('brd_decision_prd_desc')}
              </p>
              <button
                type="button"
                onClick={handleContinuePrd}
                disabled={actionLoading === 'prd'}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'prd' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {t('brd_decision_prd_action')}
              </button>
            </div>

            {/* Option C: Develop with KerjaCUS! */}
            <div className="rounded-2xl bg-surface-bright border border-success-500/30 p-5 flex flex-col">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-success-500/10">
                <Users className="h-5 w-5 text-success-600" />
              </div>
              <h4 className="text-sm font-bold text-brand-text">
                {t('brd_decision_develop_title')}
              </h4>
              <p className="mt-1 flex-1 text-xs text-on-surface-muted">
                {t('brd_decision_develop_desc')}
              </p>
              <button
                type="button"
                onClick={handleContinueDevelop}
                disabled={actionLoading === 'develop'}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-success-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-success-600/90 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'develop' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {t('brd_decision_develop_action')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
