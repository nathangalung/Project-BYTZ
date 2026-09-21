import { ProjectStatus } from '@kerjacus/shared'

/**
 * One styled, translated badge per project_status value.
 *
 * Three maps used to answer this question and none of them was complete, so
 * anything a map missed rendered `undefined` as its class - an unstyled badge
 * on a live project. Typing the table as `Record<ProjectStatus, string>` is
 * what keeps that from coming back: a value added to the shared enum fails
 * typecheck here instead of failing silently on screen.
 *
 * Colour follows the lifecycle phase, so a status reads as a position even
 * before the label does: neutral while the project is being written, amber
 * through the BRD and PRD steps (cream-500 for BRD, the deeper cream-600 for
 * PRD), blue while a team is being found, green while work runs, teal for the
 * final review, and green or red once it stops.
 */
export const PROJECT_STATUS_BADGE: Record<ProjectStatus, string> = {
  draft: 'bg-surface-container/50 text-on-surface-muted border border-outline-dim/30',
  scoping: 'bg-surface-container/80 text-on-surface border border-outline-dim/40',
  brd_review: 'bg-accent-cream-500/30 text-brand-text border border-accent-cream-500/50',
  prd_review: 'bg-accent-cream-600/30 text-brand-text border border-accent-cream-600/50',
  matching: 'bg-info-500/25 text-brand-text border border-info-500/45',
  in_progress: 'bg-success-500/20 text-success-600 border border-success-500/40',
  final_review: 'bg-brand-accent/15 text-brand-text border border-brand-accent/30',
  completed: 'bg-success-600/30 text-success-600 border border-success-600/50',
  cancelled: 'bg-error-500/15 text-error-600 border border-error-500/30',
}

/**
 * The conditions that used to be statuses, with their own badges.
 *
 * A project is at a position AND may be disputed or on hold; `disputed` and
 * `on_hold` were positions, which is why a disputed project used to forget
 * where it was. Rendered beside the position badge, never instead of it.
 */
export const PROJECT_CONDITION_BADGE = {
  disputed: 'bg-error-500/30 text-error-600 border border-error-500/50',
  on_hold: 'bg-neutral-400/20 text-on-surface-muted border border-neutral-400/40',
} as const

export type ProjectCondition = keyof typeof PROJECT_CONDITION_BADGE

/** What a project row carries besides its position. */
export type ProjectConditionSource = {
  isDisputed?: boolean | null
  onHoldAt?: string | Date | null
}

/**
 * The conditions standing on a project, in the order they are shown.
 *
 * A dispute leads: it is the one that stops the money.
 */
export function projectConditions(project: ProjectConditionSource | null | undefined) {
  const conditions: ProjectCondition[] = []
  if (project?.isDisputed) conditions.push('disputed')
  if (project?.onHoldAt) conditions.push('on_hold')
  return conditions
}

/** The label key for a condition, in the `project` namespace. */
export function projectConditionLabelKey(condition: ProjectCondition): string {
  return `condition_${condition}`
}

/** The 9 values in lifecycle order, as the shared enum declares them. */
export const PROJECT_STATUSES: readonly ProjectStatus[] = Object.values(ProjectStatus)

/**
 * The label key for a status, in the `project` namespace.
 *
 * `common.json` carried a second, drifted copy of these labels, so the same
 * project read "Aktif" on its card and "Dalam Proses" in its header. One
 * catalogue now owns them.
 */
export function projectStatusLabelKey(status: string): string {
  return `status_${status}`
}

/** Badge classes for a status the API returned, which is a plain string. */
export function projectStatusBadge(status: string): string {
  return PROJECT_STATUS_BADGE[status as ProjectStatus] ?? PROJECT_STATUS_BADGE.draft
}

/**
 * The label for a status, or the raw value if no catalogue holds it.
 *
 * i18next answers a missing key with the key, so a status the enum grows
 * before the locales do would otherwise read "status_archived" on screen.
 */
export function projectStatusLabel(translate: (key: string) => string, status: string): string {
  const key = projectStatusLabelKey(status)
  const translated = translate(key)
  return translated === key ? status : translated
}
