import type { BrdContent } from '@kerjacus/shared'

/** Per-section completeness the AI reports back with the draft. */
export type BrdSectionScore = {
  section: string
  label: string
  score: number
  reason?: string
}

export type BrdTemplateScore = {
  overall: number
  sections: BrdSectionScore[]
}

import {
  AlertTriangle,
  BarChart2,
  Box,
  Calendar,
  Check,
  ChevronRight,
  FileText,
  List,
  Shield,
  Target,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocumentWatermark } from '@/components/ui/document-watermark'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * The BRD rendered for reading.
 *
 * Same seam as the PRD: every section here reads the normalised content and
 * the paid flag and nothing else, so it is presentational and the route is
 * left holding the decisions - buy, revise, continue to a PRD.
 */
export function BrdDocumentBody({
  content: displayContent,
  isUnlocked,
}: {
  content: BrdContent
  isUnlocked: boolean
}) {
  const { t } = useTranslation('project')

  return (
    <>
      {/* BRD sections */}
      <div className="relative space-y-3">
        {!isUnlocked && <DocumentWatermark label={t('preview_watermark')} />}
        {/* Executive Summary and Business Objectives */}
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

        {displayContent.successMetrics && displayContent.successMetrics.length > 0 && (
          <BrdSection icon={<BarChart2 className="h-4 w-4" />} title={t('success_metrics')}>
            <ul className="space-y-2">
              {displayContent.successMetrics.map((metric) => (
                <li key={metric} className="flex items-start gap-2 text-sm text-on-surface-muted">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                  {metric}
                </li>
              ))}
            </ul>
          </BrdSection>
        )}

        {/* Model B: the whole BRD is visible, watermarked, before payment.
              The clean PDF download and revisions past the free two are the paid
              unlock; an assigned talent reads it as their brief. */}
        <BrdSection icon={<Box className="h-4 w-4" />} title={t('scope')}>
          <p className="text-sm leading-relaxed text-on-surface-muted">{displayContent.scope}</p>
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
                <p className="text-sm leading-relaxed text-on-surface-muted">{req.content}</p>
              </div>
            ))}
          </div>
        </BrdSection>

        <BrdSection icon={<Shield className="h-4 w-4" />} title={t('non_functional_requirements')}>
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
              <p className="text-xs font-medium text-on-surface-muted">{t('pricing_estimate')}</p>
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
              <p className="text-xs font-medium text-on-surface-muted">{t('timeline_estimate')}</p>
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
            {displayContent.riskAssessment?.map((item) => {
              // "Risk: ... | Mitigation: ..." splits into the two lines.
              const [head, mit] = item.split(/\s*\|\s*Mitigation:\s*/i)
              const risk = head.replace(/^\s*Risk:\s*/i, '')
              return (
                <div
                  key={item}
                  className="rounded-lg bg-surface-container p-4 border border-accent-coral-500/10"
                >
                  <p className="mb-1.5 text-sm font-semibold text-accent-coral-600">{risk}</p>
                  {mit && <p className="text-sm leading-relaxed text-on-surface-muted">{mit}</p>}
                </div>
              )
            })}
          </div>
        </BrdSection>
      </div>
    </>
  )
}

export function BrdTemplateScorePanel({ score }: { score: BrdTemplateScore }) {
  const { t } = useTranslation('project')
  const overall = score.overall ?? 0
  const scoreColor =
    overall >= 80
      ? 'text-success-600'
      : overall >= 50
        ? 'text-accent-cream-600'
        : 'text-accent-coral-600'
  const barColor =
    overall >= 80 ? 'bg-success-500' : overall >= 50 ? 'bg-accent-cream-500' : 'bg-accent-coral-500'

  return (
    <div className="mb-6 rounded-xl bg-surface-bright border border-outline-dim/20 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-dim/10">
        <BarChart2 className="h-4 w-4 text-on-surface-muted" />
        <span className="flex-1 text-sm font-semibold text-primary-600">
          {t('brd_template_completeness')}
        </span>
        <span className={`text-2xl font-bold ${scoreColor}`}>{overall}%</span>
      </div>
      <div className="px-5 py-4 space-y-3">
        {/* Overall bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${overall}%` }}
          />
        </div>
        {/* Per-section breakdown */}
        {score.sections.length > 0 && (
          <div className="mt-4 space-y-2">
            {score.sections.map((s) => (
              <div key={s.section} className="flex items-center gap-3">
                <span className="w-6 text-center text-xs font-bold text-on-surface-muted">
                  {s.section}
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-primary-600/70">{s.label}</span>
                    <span
                      className={
                        s.score >= 80
                          ? 'text-success-600'
                          : s.score >= 50
                            ? 'text-accent-cream-600'
                            : 'text-accent-coral-600'
                      }
                    >
                      {s.score}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
                    <div
                      className={`h-full rounded-full ${
                        s.score >= 80
                          ? 'bg-success-500'
                          : s.score >= 50
                            ? 'bg-accent-cream-500'
                            : 'bg-accent-coral-500'
                      }`}
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                  {s.reason && (
                    <p className="mt-0.5 text-xs text-on-surface-muted/70">{s.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function BrdSection({
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
