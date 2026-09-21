import { ProjectStatus } from '@kerjacus/shared'

/**
 * One styled, translated badge per project_status value.
 *
 * Three maps used to answer this question and none of them was complete: the
 * detail header knew 6 of the 18 values, the detail shell 15, and anything the
 * map missed rendered `undefined` as its class - an unstyled badge on a live
 * project. Typing the table as `Record<ProjectStatus, string>` is what keeps
 * that from coming back: a value added to the shared enum fails typecheck here
 * instead of failing silently on screen.
 *
 * Colour follows the lifecycle phase, so a status reads as a position even
 * before the label does: neutral while the project is being written, amber
 * through the BRD/PRD ladder (cream-500 for BRD, the deeper cream-600 for
 * PRD), blue while a team is being found, green while work runs, teal for the
 * final review, and red or grey once it stops.
 */
export const PROJECT_STATUS_BADGE: Record<ProjectStatus, string> = {
  draft: 'bg-surface-container/50 text-on-surface-muted border border-outline-dim/30',
  scoping: 'bg-surface-container/80 text-on-surface border border-outline-dim/40',
  brd_generated: 'bg-accent-cream-500/15 text-brand-text border border-accent-cream-500/30',
  brd_approved: 'bg-accent-cream-500/30 text-brand-text border border-accent-cream-500/50',
  brd_purchased: 'bg-accent-cream-500/50 text-brand-text border border-accent-cream-500/70',
  prd_generated: 'bg-accent-cream-600/15 text-brand-text border border-accent-cream-600/30',
  prd_approved: 'bg-accent-cream-600/30 text-brand-text border border-accent-cream-600/50',
  prd_purchased: 'bg-accent-cream-600/50 text-brand-text border border-accent-cream-600/70',
  matching: 'bg-info-500/15 text-brand-text border border-info-500/30',
  team_forming: 'bg-info-500/25 text-brand-text border border-info-500/45',
  matched: 'bg-info-500/40 text-brand-text border border-info-500/60',
  in_progress: 'bg-success-500/20 text-success-600 border border-success-500/40',
  partially_active: 'bg-success-500/10 text-success-600 border border-success-500/25',
  review: 'bg-brand-accent/15 text-brand-text border border-brand-accent/30',
  completed: 'bg-success-600/30 text-success-600 border border-success-600/50',
  cancelled: 'bg-error-500/15 text-error-600 border border-error-500/30',
  disputed: 'bg-error-500/30 text-error-600 border border-error-500/50',
  on_hold: 'bg-neutral-400/20 text-on-surface-muted border border-neutral-400/40',
}

/** The 18 values in lifecycle order, as the shared enum declares them. */
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
