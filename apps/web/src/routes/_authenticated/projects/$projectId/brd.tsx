import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  Box,
  Calendar,
  Check,
  ChevronRight,
  FileText,
  List,
  Loader2,
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

export const Route = createFileRoute('/_authenticated/projects/$projectId/brd')({
  component: BrdViewerPage,
})

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  draft: {
    color: 'bg-[#f6f3ab]/10 text-[#f6f3ab] border border-[#f6f3ab]/20',
    label: 'Draft',
  },
  review: {
    color: 'bg-[#f6f3ab]/15 text-[#f6f3ab] border border-[#f6f3ab]/30',
    label: 'Review',
  },
  approved: {
    color: 'bg-[#9fc26e]/15 text-[#9fc26e] border border-[#9fc26e]/30',
    label: 'Approved',
  },
  paid: {
    color: 'bg-[#e59a91]/15 text-[#e59a91] border border-[#e59a91]/30',
    label: 'Paid',
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

const DUMMY_BRD_CONTENT: BrdContent = {
  executiveSummary:
    "KopiNusantara is a premium e-commerce platform for artisan Indonesian coffee beans, targeting individual consumers and small cafes across the archipelago. The platform will feature curated product catalogs with origin-based filtering, flexible subscription management, integrated payment processing via Midtrans, and a responsive web experience optimized for mobile users. The goal is to connect Indonesia's best micro-roasters directly with coffee enthusiasts, eliminating middlemen and ensuring fair-trade pricing.",
  businessObjectives: [
    'Launch a fully functional e-commerce platform within 45 days of development start',
    'Enable subscription-based recurring orders with flexible delivery schedules (weekly, bi-weekly, monthly)',
    'Integrate Midtrans payment gateway supporting bank transfer, e-wallet (GoPay, OVO, Dana), and QRIS',
    'Build an admin dashboard with real-time inventory management, low-stock alerts, and order analytics',
    'Achieve mobile-first responsive design with < 2 second page load times',
    'Support multi-language interface (Bahasa Indonesia primary, English secondary)',
  ],
  scope:
    'The project encompasses full-stack development of a web-based e-commerce platform including: product catalog with advanced filtering (origin, roast level, flavor profile), customer account management, shopping cart and checkout flow, subscription management engine, payment integration, order tracking, admin inventory dashboard, and email notification system. The platform will be built as a responsive web application accessible on desktop and mobile browsers.',
  outOfScope: [
    'Native mobile applications (iOS/Android) -- planned for Phase 2',
    'Marketplace model with third-party sellers -- single-vendor only for MVP',
    'Custom logistics/shipping management system -- will integrate with existing courier APIs (JNE, SiCepat)',
    "Advanced recommendation engine using machine learning -- basic 'related products' only",
    'Physical POS integration for cafe partners',
  ],
  functionalRequirements: [
    {
      title: 'Product Catalog & Discovery',
      description:
        'Browsable product catalog with filtering by origin region, roast level (light/medium/dark), flavor profile, and price range. Each product page displays tasting notes, roaster profile, brewing recommendations, and customer reviews. Support for product variants (250g, 500g, 1kg).',
    },
    {
      title: 'User Authentication & Profiles',
      description:
        'Registration and login via email/password and Google OAuth. User profiles with saved addresses, order history, subscription management, and taste preference settings. Password reset via email.',
    },
    {
      title: 'Shopping Cart & Checkout',
      description:
        'Persistent shopping cart with quantity adjustment, promo code support, shipping cost calculation based on destination, and multi-step checkout flow. Guest checkout option with account creation prompt post-purchase.',
    },
    {
      title: 'Subscription Engine',
      description:
        'Customers can subscribe to recurring deliveries with configurable frequency (weekly, bi-weekly, monthly). Subscription dashboard to pause, skip, modify, or cancel. Automatic billing on cycle date with retry logic for failed payments.',
    },
    {
      title: 'Payment Integration (Midtrans)',
      description:
        'Full Midtrans integration supporting: bank transfer (BCA, BNI, Mandiri), e-wallets (GoPay, OVO, Dana, ShopeePay), QRIS, and credit/debit cards. Webhook handling for payment status updates. Automatic invoice generation.',
    },
    {
      title: 'Admin Inventory & Order Dashboard',
      description:
        'Real-time inventory tracking with stock level management, low-stock email alerts (configurable threshold), bulk product upload via CSV, order management with status updates, and basic revenue analytics with daily/weekly/monthly views.',
    },
  ],
  nonFunctionalRequirements: [
    'Page load time < 2 seconds on 4G mobile connections (P95)',
    '99.5% uptime SLA with automated health monitoring',
    'Support for 500 concurrent users without degradation',
    'All data encrypted at rest (AES-256) and in transit (TLS 1.3)',
    'WCAG 2.1 AA accessibility compliance for all public-facing pages',
    'Responsive design supporting viewports from 320px to 2560px',
    'SEO-optimized with server-side rendering for product pages',
    'GDPR-compliant data handling with user data export/deletion capability',
  ],
  estimatedPriceMin: 18000000,
  estimatedPriceMax: 28000000,
  estimatedTimelineDays: 45,
  estimatedTeamSize: 3,
  riskAssessment: [
    {
      risk: 'Midtrans integration delays due to sandbox-to-production approval timeline',
      mitigation:
        'Begin Midtrans merchant registration in parallel with development. Use sandbox for full integration testing. Buffer 5 additional days for production approval.',
    },
    {
      risk: 'Subscription billing edge cases (failed payments, timezone issues, prorated charges)',
      mitigation:
        'Implement comprehensive retry logic with exponential backoff. Use UTC timestamps internally. Define clear proration rules in PRD. Extensive QA testing with simulated payment failures.',
    },
    {
      risk: 'Scope creep from additional feature requests during development',
      mitigation:
        'Strict change request process with impact analysis (timeline and cost). All new features logged as Phase 2 backlog unless critical for launch.',
    },
    {
      risk: 'Performance bottlenecks on product listing pages with large catalogs',
      mitigation:
        'Implement cursor-based pagination, image lazy loading, CDN for static assets. Load test with 1000+ products before launch.',
    },
  ],
}

function BrdViewerPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: brd, isLoading: brdLoading } = useProjectBrd(projectId)
  const { data: project } = useProject(projectId)
  const transitionProject = useTransitionProject()
  const [revisionMode, setRevisionMode] = useState(false)
  const [revisionText, setRevisionText] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  if (brdLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 bg-[#152e34]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#9fc26e]" />
          <p className="text-sm text-[#5e677d]">{t('brd_loading')}</p>
        </div>
      </div>
    )
  }

  const hasBrd = !!brd
  const content: BrdContent = hasBrd ? ((brd.content as BrdContent) ?? {}) : {}
  const brdStatus = hasBrd ? brd.status : 'review'
  const brdVersion = hasBrd ? brd.version : 1
  const statusInfo = STATUS_BADGE[brdStatus] ?? STATUS_BADGE.draft

  const displayContent: BrdContent = {
    executiveSummary: content.executiveSummary ?? DUMMY_BRD_CONTENT.executiveSummary,
    businessObjectives: content.businessObjectives ?? DUMMY_BRD_CONTENT.businessObjectives,
    scope: content.scope ?? DUMMY_BRD_CONTENT.scope,
    outOfScope: content.outOfScope ?? DUMMY_BRD_CONTENT.outOfScope,
    functionalRequirements:
      content.functionalRequirements ?? DUMMY_BRD_CONTENT.functionalRequirements,
    nonFunctionalRequirements:
      content.nonFunctionalRequirements ?? DUMMY_BRD_CONTENT.nonFunctionalRequirements,
    estimatedPriceMin: content.estimatedPriceMin ?? DUMMY_BRD_CONTENT.estimatedPriceMin,
    estimatedPriceMax: content.estimatedPriceMax ?? DUMMY_BRD_CONTENT.estimatedPriceMax,
    estimatedTimelineDays: content.estimatedTimelineDays ?? DUMMY_BRD_CONTENT.estimatedTimelineDays,
    estimatedTeamSize: content.estimatedTeamSize ?? DUMMY_BRD_CONTENT.estimatedTeamSize,
    riskAssessment: content.riskAssessment ?? DUMMY_BRD_CONTENT.riskAssessment,
  }

  async function handleApprove() {
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
      navigate({ to: '/projects' })
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
    <div className="min-h-screen bg-[#152e34] p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#f6f3ab] tracking-tight">{t('brd_title')}</h1>
            {project && <p className="mt-1 text-sm text-[#5e677d]">{project.title}</p>}
            {!hasBrd && (
              <p className="mt-1 text-sm text-[#5e677d]">KopiNusantara E-Commerce Platform</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', statusInfo.color)}>
              {statusInfo.label}
            </span>
            <span className="text-xs text-[#5e677d]">
              {t('version')} {brdVersion}
            </span>
          </div>
        </div>

        {/* BRD sections */}
        <div className="space-y-3">
          <BrdSection
            icon={<FileText className="h-4 w-4" />}
            title={t('executive_summary')}
            defaultOpen
          >
            <p className="text-sm leading-relaxed text-[#5e677d]">
              {displayContent.executiveSummary}
            </p>
          </BrdSection>

          <BrdSection icon={<Target className="h-4 w-4" />} title={t('business_objectives')}>
            <ul className="space-y-2">
              {displayContent.businessObjectives?.map((obj, i) => (
                <li key={obj} className="flex items-start gap-3 text-sm text-[#5e677d]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#9fc26e]/15 text-xs font-medium text-[#9fc26e]">
                    {i + 1}
                  </span>
                  {obj}
                </li>
              ))}
            </ul>
          </BrdSection>

          <BrdSection icon={<Box className="h-4 w-4" />} title={t('scope')}>
            <p className="text-sm leading-relaxed text-[#5e677d]">{displayContent.scope}</p>
          </BrdSection>

          <BrdSection icon={<XCircle className="h-4 w-4" />} title={t('out_of_scope')}>
            <ul className="space-y-2">
              {displayContent.outOfScope?.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-[#5e677d]">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-[#e59a91]/60" />
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
                  className="rounded-lg bg-[#112630] p-4 border border-[#5e677d]/15"
                >
                  <h4 className="mb-1.5 text-sm font-semibold text-[#f6f3ab]">{req.title}</h4>
                  <p className="text-sm leading-relaxed text-[#5e677d]">{req.description}</p>
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
                <li key={req} className="flex items-start gap-2 text-sm text-[#5e677d]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#9fc26e]" />
                  {req}
                </li>
              ))}
            </ul>
          </BrdSection>

          {/* Estimation cards */}
          <BrdSection icon={<Wallet className="h-4 w-4" />} title={t('estimation')} defaultOpen>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#112630] p-4 text-center border border-[#5e677d]/15">
                <Wallet className="mx-auto mb-2 h-5 w-5 text-[#9fc26e]" />
                <p className="text-xs font-medium text-[#5e677d]">{t('pricing_estimate')}</p>
                <p className="mt-1 text-sm font-bold text-[#f6f3ab]">
                  {formatCurrency(displayContent.estimatedPriceMin ?? 0)}
                </p>
                <p className="text-xs text-[#5e677d]">-</p>
                <p className="text-sm font-bold text-[#f6f3ab]">
                  {formatCurrency(displayContent.estimatedPriceMax ?? 0)}
                </p>
              </div>
              <div className="rounded-lg bg-[#112630] p-4 text-center border border-[#5e677d]/15">
                <Calendar className="mx-auto mb-2 h-5 w-5 text-[#e59a91]" />
                <p className="text-xs font-medium text-[#5e677d]">{t('timeline_estimate')}</p>
                <p className="mt-1 text-lg font-bold text-[#f6f3ab]">
                  {displayContent.estimatedTimelineDays}
                </p>
                <p className="text-xs text-[#5e677d]">{t('days')}</p>
              </div>
              <div className="rounded-lg bg-[#112630] p-4 text-center border border-[#5e677d]/15">
                <Users className="mx-auto mb-2 h-5 w-5 text-[#f6f3ab]" />
                <p className="text-xs font-medium text-[#5e677d]">{t('team_size')}</p>
                <p className="mt-1 text-lg font-bold text-[#f6f3ab]">
                  {displayContent.estimatedTeamSize}
                </p>
                <p className="text-xs text-[#5e677d]">{t('persons')}</p>
              </div>
            </div>
          </BrdSection>

          <BrdSection icon={<AlertTriangle className="h-4 w-4" />} title={t('risk_assessment')}>
            <div className="space-y-3">
              {displayContent.riskAssessment?.map((item) => (
                <div
                  key={item.risk}
                  className="rounded-lg bg-[#112630] p-4 border border-[#e59a91]/15"
                >
                  <p className="mb-1.5 text-sm font-semibold text-[#e59a91]">{item.risk}</p>
                  <p className="text-sm leading-relaxed text-[#5e677d]">{item.mitigation}</p>
                </div>
              ))}
            </div>
          </BrdSection>
        </div>

        {/* Revision input */}
        {revisionMode && (
          <div className="mt-6 rounded-xl bg-[#3b526a] p-5 border border-[#5e677d]/20">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-[#f6f3ab]">{t('request_revision')}</h3>
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded p-1 text-[#5e677d] hover:text-[#f6f3ab] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              placeholder={t('revision_placeholder')}
              className="w-full resize-none rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-3 py-2.5 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRevisionMode(false)
                  setRevisionText('')
                }}
                className="rounded-lg border border-[#5e677d]/40 px-4 py-2 text-sm font-medium text-[#f6f3ab]/70 hover:bg-[#112630] transition-colors"
              >
                {t('cancel_revision')}
              </button>
              <button
                type="button"
                onClick={handleSendRevision}
                disabled={!revisionText.trim() || actionLoading === 'revision'}
                className="inline-flex items-center gap-2 rounded-lg bg-[#9fc26e] px-4 py-2 text-sm font-medium text-[#0d1e28] hover:bg-[#9fc26e]/90 disabled:opacity-50 transition-colors"
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
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[#5e677d]/20 pt-6">
          <button
            type="button"
            onClick={handleApprove}
            disabled={actionLoading === 'approve'}
            className="inline-flex items-center gap-2 rounded-lg bg-[#9fc26e] px-5 py-2.5 text-sm font-semibold text-[#0d1e28] shadow-sm hover:bg-[#9fc26e]/90 disabled:opacity-50 transition-colors"
          >
            {actionLoading === 'approve' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t('approve_brd')}
          </button>
          <button
            type="button"
            onClick={() => setRevisionMode(true)}
            disabled={revisionMode}
            className="inline-flex items-center gap-2 rounded-lg border border-[#f6f3ab]/30 px-5 py-2.5 text-sm font-medium text-[#f6f3ab] hover:bg-[#3b526a]/50 disabled:opacity-50 transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            {t('request_revision')}
          </button>
          <button
            type="button"
            onClick={handleBuyBrd}
            disabled={actionLoading === 'buy'}
            className="inline-flex items-center gap-2 rounded-lg bg-[#e59a91] px-5 py-2.5 text-sm font-semibold text-[#0d1e28] hover:bg-[#e59a91]/90 disabled:opacity-50 transition-colors"
          >
            {actionLoading === 'buy' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
            {t('buy_brd_only')}
          </button>
        </div>

        {/* Decision info */}
        <div className="mt-6 rounded-lg bg-[#112630] p-4 border border-[#9fc26e]/15">
          <h3 className="mb-2 text-sm font-semibold text-[#9fc26e]">{t('brd_decision_title')}</h3>
          <ul className="space-y-2 text-sm text-[#5e677d]">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9fc26e]" />
              {t('brd_option_a')}
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f6f3ab]" />
              {t('brd_option_b')}
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e59a91]" />
              {t('brd_option_c')}
            </li>
          </ul>
        </div>
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
    <div className="rounded-xl bg-[#3b526a] border border-[#5e677d]/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#3b526a]/80 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="text-[#5e677d]">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-[#f6f3ab]">{title}</span>
        <span
          className={cn('text-[#5e677d] transition-transform duration-200', isOpen && 'rotate-90')}
        >
          <ChevronRight className="h-4 w-4" />
        </span>
      </button>
      {isOpen && <div className="border-t border-[#5e677d]/15 px-5 py-4">{children}</div>}
    </div>
  )
}
