import type { PrdContent } from '@kerjacus/shared'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Code2,
  Cpu,
  Database,
  GitBranch,
  Globe,
  Layers,
  Lightbulb,
  Package,
  Palette,
  Server,
  Settings,
  Smartphone,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocumentWatermark } from '@/components/ui/document-watermark'
import { cn, formatCurrency } from '@/lib/utils'

// HTTP verb colours for the API design table.
const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-success-500/10 text-success-600',
  POST: 'bg-brand-accent/15 text-brand-text',
  PUT: 'bg-warning-500/10 text-warning-600',
  PATCH: 'bg-warning-500/10 text-warning-600',
  DELETE: 'bg-error-500/10 text-error-600',
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

/**
 * The PRD rendered for reading.
 *
 * Extracted from a 886-line route that was one component with a very long
 * render. Every section here reads the normalised content and nothing else -
 * no state, no mutations, no route params - so it is presentational, and
 * separating it lets the route hold the decisions instead.
 */
export function PrdDocumentBody({
  content: displayContent,
  isUnlocked,
}: {
  content: PrdContent
  isUnlocked: boolean
}) {
  const { t } = useTranslation('project')

  return (
    <>
      {/* PRD sections */}
      <div className="relative space-y-3">
        {!isUnlocked && <DocumentWatermark label={t('preview_watermark')} />}
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
                      <h4 className="text-sm font-medium text-brand-text">{tech.name}</h4>
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

        {/* Model B: the whole PRD is visible, watermarked, before payment.
              The clean PDF download and revisions past the free two are the
              paid unlock; an assigned talent reads it as their brief. */}
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
                          METHOD_COLORS[ep.method] ?? 'bg-surface-container text-on-surface-muted',
                        )}
                      >
                        {ep.method}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <code className="text-xs text-brand-text">{ep.path}</code>
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
                  <h4 className="text-sm font-medium text-brand-text">{table.name}</h4>
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
        <PrdSection icon={<Users className="h-4 w-4" />} title={t('team_composition')} defaultOpen>
          <div className="grid gap-3 sm:grid-cols-3">
            {displayContent.teamComposition?.map((member) => (
              <div
                key={member.role}
                className="rounded-xl border border-outline-dim/20 bg-surface-bright p-4"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-accent/10">
                  <Users className="h-5 w-5 text-brand-accent" />
                </div>
                <h4 className="text-sm font-semibold text-brand-text">{member.role}</h4>
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
                      <span className="text-sm font-medium text-brand-text">{wp.name}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {wp.requiredSkills.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-medium text-brand-text"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right text-sm text-on-surface-muted">
                      {wp.estimatedHours}h
                    </td>
                    <td className="py-3 pr-4 text-right text-sm font-medium text-brand-text">
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
                        <span className="text-xs text-on-surface-muted">{t('no_dependency')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-outline-dim/20">
                  <td className="pt-3 pr-4 text-sm font-semibold text-brand-text">
                    {t('total_cost')}
                  </td>
                  <td className="pt-3 pr-4" />
                  <td className="pt-3 pr-4 text-right text-sm font-semibold text-brand-text">
                    {displayContent.workPackages?.reduce((sum, wp) => sum + wp.estimatedHours, 0)}h
                  </td>
                  <td className="pt-3 pr-4 text-right text-sm font-semibold text-brand-text">
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

        {/* Deliverables & Acceptance -- the concrete brief a talent builds from */}
        {displayContent.workPackages.some(
          (wp) => wp.deliverables.length > 0 || wp.acceptanceCriteria.length > 0,
        ) && (
          <PrdSection
            icon={<ClipboardCheck className="h-4 w-4" />}
            title={t('deliverables_acceptance')}
            defaultOpen
          >
            <div className="space-y-4">
              {displayContent.workPackages
                .filter((wp) => wp.deliverables.length > 0 || wp.acceptanceCriteria.length > 0)
                .map((wp) => (
                  <div
                    key={wp.name}
                    className="rounded-lg border border-outline-dim/10 bg-surface-bright p-4"
                  >
                    <h4 className="mb-2 text-sm font-semibold text-brand-text">{wp.name}</h4>
                    {wp.deliverables.length > 0 && (
                      <div className="mb-3">
                        <p className="mb-1 text-xs font-medium text-on-surface-muted">
                          {t('deliverables')}
                        </p>
                        <ul className="space-y-1">
                          {wp.deliverables.map((d) => (
                            <li
                              key={d.title}
                              className="flex items-start gap-2 text-xs text-on-surface-muted"
                            >
                              <Package className="mt-0.5 h-3 w-3 shrink-0 text-brand-accent" />
                              <span>
                                <span className="font-medium text-brand-text">{d.title}</span>
                                {d.expected ? ` — ${d.expected}` : ''}
                                <span className="ml-1.5 rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-medium">
                                  {d.type}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {wp.acceptanceCriteria.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-on-surface-muted">
                          {t('acceptance_criteria')}
                        </p>
                        <ul className="space-y-1">
                          {wp.acceptanceCriteria.map((ac) => (
                            <li
                              key={ac}
                              className="flex items-start gap-2 text-xs text-on-surface-muted"
                            >
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-success-500" />
                              {ac}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </PrdSection>
        )}

        {/* Sprint Plan */}
        <PrdSection icon={<Calendar className="h-4 w-4" />} title={t('sprint_plan')}>
          <div className="space-y-4">
            {displayContent.sprintPlan?.map((sprint, sprintIndex) => (
              <div key={sprint.name} className="relative pl-8">
                {/* Timeline dot and line */}
                <div className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                  {sprintIndex + 1}
                </div>
                {sprintIndex < (displayContent.sprintPlan?.length ?? 0) - 1 && (
                  <div className="absolute left-[11px] top-6 h-full w-0.5 bg-brand-accent/15" />
                )}
                <div className="rounded-lg border border-outline-dim/10 bg-surface-bright p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-brand-text">{sprint.name}</h4>
                    <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-medium text-brand-text">
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
                <span className="rounded bg-brand-accent/10 px-2 py-1 text-xs font-medium text-brand-text">
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

        {/* Assumptions */}
        {displayContent.assumptions.length > 0 && (
          <PrdSection icon={<Lightbulb className="h-4 w-4" />} title={t('assumptions')}>
            <ul className="space-y-1.5">
              {displayContent.assumptions.map((a) => (
                <li key={a} className="flex items-start gap-2 text-sm text-on-surface-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-muted" />
                  {a}
                </li>
              ))}
            </ul>
          </PrdSection>
        )}

        {/* Risks */}
        {displayContent.risks.length > 0 && (
          <PrdSection icon={<AlertTriangle className="h-4 w-4" />} title={t('risks')}>
            <ul className="space-y-1.5">
              {displayContent.risks.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-on-surface-muted">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-600" />
                  {r}
                </li>
              ))}
            </ul>
          </PrdSection>
        )}
      </div>
    </>
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
        <span className="flex-1 text-sm font-semibold text-brand-text">{title}</span>
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
