import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Calendar,
  Check,
  ChevronRight,
  FileText,
  List,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  Shield,
  ShoppingCart,
  Target,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProject, useProjectBrd, useTransitionProject } from '@/hooks/use-projects'
import { cn, formatCurrency } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/brd')({
  component: BrdViewerPage,
})

const STATUS_BADGE: Record<string, { color: string; labelKey: string }> = {
  draft: {
    color: 'bg-accent-cream-500/10 text-primary-600 border border-accent-cream-500/20',
    labelKey: 'status_draft',
  },
  review: {
    color: 'bg-accent-cream-500/15 text-primary-600 border border-primary-500/20',
    labelKey: 'status_review',
  },
  approved: {
    color: 'bg-primary-600/15 text-success-600 border border-success-500/30',
    labelKey: 'status_approved',
  },
  paid: {
    color: 'bg-accent-coral-500/15 text-accent-coral-600 border border-accent-coral-500/30',
    labelKey: 'status_paid',
  },
}

type BrdContent = {
  executiveSummary?: string
  businessObjectives?: string[]
  scope?: string
  outOfScope?: string[]
  functionalRequirements?: Array<{ title: string; description: string }>
  nonFunctionalRequirements?: string[]
  estimatedPriceMin?: number
  estimatedPriceMax?: number
  estimatedTimelineDays?: number
  estimatedTeamSize?: number
  pricingEstimate?: string
  timelineEstimate?: string
  riskAssessment?: Array<{ risk: string; mitigation: string }>
}

function BrdViewerPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: brd, isLoading: brdLoading } = useProjectBrd(projectId)
  const { data: project } = useProject(projectId)
  const transitionProject = useTransitionProject()
  const { addToast } = useToastStore()
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
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-500/10">
            <FileText className="h-8 w-8 text-primary-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary-600">
            {t('brd_not_created', 'BRD belum dibuat')}
          </h2>
          <p className="mt-2 text-sm text-on-surface-muted">
            {t(
              'brd_not_created_desc',
              'Selesaikan proses scoping terlebih dahulu untuk menghasilkan BRD.',
            )}
          </p>
          <Link
            to="/projects/$projectId/scoping"
            params={{ projectId }}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
            {t('go_to_scoping', 'Ke Halaman Scoping')}
          </Link>
        </div>
      </div>
    )
  }

  const raw = (brd.content ?? {}) as Record<string, unknown>
  const content: BrdContent = {
    executiveSummary: String(raw.executiveSummary ?? raw.executive_summary ?? ''),
    businessObjectives: Array.isArray(raw.businessObjectives ?? raw.business_objectives)
      ? ((raw.businessObjectives ?? raw.business_objectives) as string[])
      : [],
    scope: String(raw.scope ?? ''),
    functionalRequirements: Array.isArray(raw.functionalRequirements ?? raw.functional_requirements)
      ? ((raw.functionalRequirements ?? raw.functional_requirements) as Array<{
          title: string
          description: string
        }>)
      : [],
    nonFunctionalRequirements: Array.isArray(
      raw.nonFunctionalRequirements ?? raw.non_functional_requirements,
    )
      ? ((raw.nonFunctionalRequirements ?? raw.non_functional_requirements) as string[])
      : [],
    estimatedPriceMin: Number(raw.estimatedPriceMin ?? raw.estimated_price_min) || 0,
    estimatedPriceMax: Number(raw.estimatedPriceMax ?? raw.estimated_price_max) || 0,
    estimatedTimelineDays: Number(raw.estimatedTimelineDays ?? raw.estimated_timeline_days) || 0,
    estimatedTeamSize: Number(raw.estimatedTeamSize ?? raw.team_size) || 1,
    riskAssessment: Array.isArray(raw.riskAssessment ?? raw.risk_assessment)
      ? ((raw.riskAssessment ?? raw.risk_assessment) as Array<{ risk: string; mitigation: string }>)
      : [],
  }
  const brdStatus = brd.status
  const brdVersion = brd.version
  const brdPrice = brd.price
  const statusInfo = STATUS_BADGE[brdStatus] ?? STATUS_BADGE.draft
  const isUnlocked = brdStatus === 'paid' || brdStatus === 'approved'

  const displayContent: BrdContent = content

  async function _handleApprove() {
    setActionLoading('approve')
    try {
      await transitionProject.mutateAsync({
        projectId,
        transition: 'approve_brd',
      })
    } catch {
      // Error handled by mutation state
    } finally {
      setActionLoading(null)
    }
  }

  async function handleBuyBrd() {
    setActionLoading('buy')
    try {
      await transitionProject.mutateAsync({
        projectId,
        transition: 'purchase_brd',
      })
      addToast(
        'success',
        t(
          'brd_purchased_success',
          'BRD berhasil dibeli. Anda dapat mengunduh dokumen dari halaman proyek.',
        ),
      )
      navigate({ to: '/projects' })
    } catch {
      addToast('error', t('brd_purchased_error', 'Gagal membeli BRD. Silakan coba lagi.'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleContinuePrd() {
    setActionLoading('prd')
    try {
      await transitionProject.mutateAsync({
        projectId,
        transition: 'generate_prd',
      })
      addToast(
        'success',
        t('prd_generation_started', 'PRD sedang di-generate. Anda akan diarahkan ke halaman PRD.'),
      )
      navigate({ to: '/projects/$projectId/prd', params: { projectId } })
    } catch {
      addToast('error', t('prd_generation_error', 'Gagal memulai generate PRD. Silakan coba lagi.'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleContinueDevelop() {
    setActionLoading('develop')
    try {
      await transitionProject.mutateAsync({
        projectId,
        transition: 'start_matching',
      })
      addToast('success', t('matching_started', 'Proses pencarian talenta dimulai.'))
      navigate({ to: '/projects/$projectId/matching', params: { projectId } })
    } catch {
      addToast('error', t('matching_error', 'Gagal memulai proses matching. Silakan coba lagi.'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSendRevision() {
    if (!revisionText.trim()) return
    setActionLoading('revision')
    try {
      const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'
      await fetch(`${API_URL}/api/v1/projects/${projectId}/brd/revision`, {
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
    <div className="bg-surface p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary-600 tracking-tight">{t('brd_title')}</h1>
            {project && <p className="mt-1 text-sm text-on-surface-muted">{project.title}</p>}
          </div>
          <div className="flex items-center gap-3">
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', statusInfo.color)}>
              {t(statusInfo.labelKey)}
            </span>
            <span className="text-xs text-on-surface-muted">
              {t('version')} {brdVersion}
            </span>
          </div>
        </div>

        {/* BRD sections */}
        <div className="space-y-3">
          {/* Free preview sections: Executive Summary and Business Objectives */}
          <BrdSection
            icon={<FileText className="h-4 w-4" />}
            title={t('executive_summary')}
            defaultOpen
          >
            <p className="text-sm leading-relaxed text-on-surface-muted">
              {displayContent.executiveSummary}
            </p>
          </BrdSection>

          <BrdSection icon={<Target className="h-4 w-4" />} title={t('business_objectives')}>
            <ul className="space-y-2">
              {displayContent.businessObjectives?.map((obj, i) => (
                <li key={obj} className="flex items-start gap-3 text-sm text-on-surface-muted">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600/15 text-xs font-medium text-success-600">
                    {i + 1}
                  </span>
                  {obj}
                </li>
              ))}
            </ul>
          </BrdSection>

          {/* Locked sections: shown blurred with paywall overlay when not paid */}
          {!isUnlocked && (
            <div className="relative">
              {/* Blurred locked sections */}
              <div className="pointer-events-none select-none space-y-3 blur-sm opacity-60">
                <BrdSection icon={<Box className="h-4 w-4" />} title={t('scope')}>
                  <p className="text-sm leading-relaxed text-on-surface-muted">
                    {displayContent.scope}
                  </p>
                </BrdSection>

                <BrdSection
                  icon={<List className="h-4 w-4" />}
                  title={t('functional_requirements')}
                >
                  <div className="space-y-4">
                    {displayContent.functionalRequirements?.slice(0, 2).map((req) => (
                      <div
                        key={req.title}
                        className="rounded-lg bg-surface-container p-4 border border-outline-dim/10"
                      >
                        <h4 className="mb-1.5 text-sm font-semibold text-primary-600">
                          {req.title}
                        </h4>
                        <p className="text-sm leading-relaxed text-on-surface-muted">
                          {req.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </BrdSection>

                <BrdSection icon={<Wallet className="h-4 w-4" />} title={t('estimation')}>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
                      <p className="text-sm font-bold text-primary-600">Rp ***</p>
                    </div>
                  </div>
                </BrdSection>

                <BrdSection
                  icon={<AlertTriangle className="h-4 w-4" />}
                  title={t('risk_assessment')}
                >
                  <p className="text-sm text-on-surface-muted">Risk data hidden</p>
                </BrdSection>
              </div>

              {/* Paywall overlay card */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-2xl bg-surface-bright border border-outline-dim/20 p-8 text-center shadow-lg max-w-md mx-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-coral-500/10">
                    <Lock className="h-7 w-7 text-accent-coral-600" />
                  </div>
                  <h3 className="text-lg font-bold text-primary-600">
                    {t('brd_locked_title', 'Konten Terkunci')}
                  </h3>
                  <p className="mt-2 text-sm text-on-surface-muted">
                    {t(
                      'brd_locked_description',
                      'Bayar untuk akses BRD lengkap termasuk scope, kebutuhan fungsional, estimasi harga, timeline, dan penilaian risiko.',
                    )}
                  </p>
                  <p className="mt-4 text-2xl font-bold text-primary-600">
                    {formatCurrency(brdPrice)}
                  </p>
                  <Link
                    to="/projects/$projectId/checkout"
                    params={{ projectId }}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-600/90 transition-colors"
                  >
                    <Wallet className="h-4 w-4" />
                    {t('brd_unlock_button', 'Buka Akses BRD Lengkap')}
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Unlocked: show all remaining sections normally */}
          {isUnlocked && (
            <>
              <BrdSection icon={<Box className="h-4 w-4" />} title={t('scope')}>
                <p className="text-sm leading-relaxed text-on-surface-muted">
                  {displayContent.scope}
                </p>
              </BrdSection>

              <BrdSection icon={<XCircle className="h-4 w-4" />} title={t('out_of_scope')}>
                <ul className="space-y-2">
                  {displayContent.outOfScope?.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-on-surface-muted">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-accent-coral-600/60" />
                      {item}
                    </li>
                  ))}
                </ul>
              </BrdSection>

              <BrdSection
                icon={<List className="h-4 w-4" />}
                title={t('functional_requirements')}
                defaultOpen
              >
                <div className="space-y-4">
                  {displayContent.functionalRequirements?.map((req) => (
                    <div
                      key={req.title}
                      className="rounded-lg bg-surface-container p-4 border border-outline-dim/10"
                    >
                      <h4 className="mb-1.5 text-sm font-semibold text-primary-600">{req.title}</h4>
                      <p className="text-sm leading-relaxed text-on-surface-muted">
                        {req.description}
                      </p>
                    </div>
                  ))}
                </div>
              </BrdSection>

              <BrdSection
                icon={<Shield className="h-4 w-4" />}
                title={t('non_functional_requirements')}
              >
                <ul className="space-y-2">
                  {displayContent.nonFunctionalRequirements?.map((req) => (
                    <li key={req} className="flex items-start gap-2 text-sm text-on-surface-muted">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                      {req}
                    </li>
                  ))}
                </ul>
              </BrdSection>

              <BrdSection icon={<Wallet className="h-4 w-4" />} title={t('estimation')} defaultOpen>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
                    <Wallet className="mx-auto mb-2 h-5 w-5 text-success-600" />
                    <p className="text-xs font-medium text-on-surface-muted">
                      {t('pricing_estimate')}
                    </p>
                    <p className="mt-1 text-sm font-bold text-primary-600">
                      {formatCurrency(displayContent.estimatedPriceMin ?? 0)}
                    </p>
                    <p className="text-xs text-on-surface-muted">-</p>
                    <p className="text-sm font-bold text-primary-600">
                      {formatCurrency(displayContent.estimatedPriceMax ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
                    <Calendar className="mx-auto mb-2 h-5 w-5 text-accent-coral-600" />
                    <p className="text-xs font-medium text-on-surface-muted">
                      {t('timeline_estimate')}
                    </p>
                    <p className="mt-1 text-lg font-bold text-primary-600">
                      {displayContent.estimatedTimelineDays}
                    </p>
                    <p className="text-xs text-on-surface-muted">{t('days')}</p>
                  </div>
                  <div className="rounded-lg bg-surface-container p-4 text-center border border-outline-dim/10">
                    <Users className="mx-auto mb-2 h-5 w-5 text-primary-600" />
                    <p className="text-xs font-medium text-on-surface-muted">{t('team_size')}</p>
                    <p className="mt-1 text-lg font-bold text-primary-600">
                      {displayContent.estimatedTeamSize}
                    </p>
                    <p className="text-xs text-on-surface-muted">{t('persons')}</p>
                  </div>
                </div>
              </BrdSection>

              <BrdSection icon={<AlertTriangle className="h-4 w-4" />} title={t('risk_assessment')}>
                <div className="space-y-3">
                  {displayContent.riskAssessment?.map((item) => (
                    <div
                      key={item.risk}
                      className="rounded-lg bg-surface-container p-4 border border-accent-coral-500/10"
                    >
                      <p className="mb-1.5 text-sm font-semibold text-accent-coral-600">
                        {item.risk}
                      </p>
                      <p className="text-sm leading-relaxed text-on-surface-muted">
                        {item.mitigation}
                      </p>
                    </div>
                  ))}
                </div>
              </BrdSection>
            </>
          )}
        </div>

        {/* Revision input (only when unlocked) */}
        {isUnlocked && revisionMode && (
          <div className="mt-6 rounded-xl bg-surface-bright p-5 border border-outline-dim/20">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-primary-600">{t('request_revision')}</h3>
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded p-1 text-on-surface-muted hover:text-primary-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              placeholder={t('revision_placeholder')}
              className="w-full resize-none rounded-lg border border-outline-dim/20 bg-surface-container px-3 py-2.5 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-primary-600/70 hover:bg-surface-container transition-colors"
              >
                {t('cancel_revision')}
              </button>
              <button
                type="button"
                onClick={handleSendRevision}
                disabled={!revisionText.trim() || actionLoading === 'revision'}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600/90 disabled:opacity-50 transition-colors"
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

        {/* Action buttons and decision cards (only when unlocked) */}
        {isUnlocked && (
          <>
            {/* Revision button */}
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-outline-dim/20 pt-6">
              <button
                type="button"
                onClick={() => setRevisionMode(true)}
                disabled={revisionMode}
                className="inline-flex items-center gap-2 rounded-lg border border-primary-500/20 px-5 py-2.5 text-sm font-medium text-primary-600 hover:bg-surface-bright/50 disabled:opacity-50 transition-colors"
              >
                <MessageSquare className="h-4 w-4" />
                {t('request_revision')}
              </button>
            </div>

            {/* Decision cards */}
            <div className="mt-8">
              <h3 className="mb-4 text-lg font-bold text-primary-600">{t('brd_decision_title')}</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Option A: Buy BRD Only */}
                <div className="rounded-2xl bg-surface-bright border border-outline-dim/20 p-5 flex flex-col">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600/10">
                    <ShoppingCart className="h-5 w-5 text-primary-600" />
                  </div>
                  <h4 className="text-sm font-bold text-primary-600">
                    {t('brd_decision_buy_title', 'Beli BRD Saja')}
                  </h4>
                  <p className="mt-1 flex-1 text-xs text-on-surface-muted">
                    {t(
                      'brd_decision_buy_desc',
                      'Gunakan dokumen BRD untuk dikerjakan sendiri atau vendor lain.',
                    )}
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
                <div className="rounded-2xl bg-surface-bright border border-primary-500/30 p-5 flex flex-col ring-1 ring-primary-500/10">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-cream-500/20">
                    <FileText className="h-5 w-5 text-primary-600" />
                  </div>
                  <h4 className="text-sm font-bold text-primary-600">
                    {t('brd_decision_prd_title', 'Lanjut ke PRD')}
                  </h4>
                  <p className="mt-1 flex-1 text-xs text-on-surface-muted">
                    {t(
                      'brd_decision_prd_desc',
                      'Dapatkan dokumen teknis lengkap: tech stack, API design, database schema.',
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={handleContinuePrd}
                    disabled={actionLoading === 'prd'}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-600/90 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading === 'prd' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {t('brd_decision_prd_action', 'Lanjut ke PRD')}
                  </button>
                </div>

                {/* Option C: Develop with KerjaCUS! */}
                <div className="rounded-2xl bg-surface-bright border border-success-500/30 p-5 flex flex-col">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-success-500/10">
                    <Users className="h-5 w-5 text-success-600" />
                  </div>
                  <h4 className="text-sm font-bold text-primary-600">
                    {t('brd_decision_develop_title', 'Develop dengan KerjaCUS!')}
                  </h4>
                  <p className="mt-1 flex-1 text-xs text-on-surface-muted">
                    {t(
                      'brd_decision_develop_desc',
                      'Platform akan mencarikan talenta dan mengelola proyek dari awal sampai selesai.',
                    )}
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
                    {t('brd_decision_develop_action', 'Mulai Develop')}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BrdSection({
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
    <div className="rounded-xl bg-surface-bright border border-outline-dim/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-surface-bright/80 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="text-on-surface-muted">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-primary-600">{title}</span>
        <span
          className={cn(
            'text-on-surface-muted transition-transform duration-200',
            isOpen && 'rotate-90',
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </span>
      </button>
      {isOpen && <div className="border-t border-outline-dim/10 px-5 py-4">{children}</div>}
    </div>
  )
}
