import { OPEN_TO_TALENT_STATUSES } from '@kerjacus/shared'
import { ApiError } from '@/lib/api'

/**
 * Why a talent may or may not apply to a project, decided once.
 *
 * The talent dashboard already refused to offer an apply button the server
 * would reject, but the project detail page - the other surface that carries
 * "Lamar Proyek" - never got the same treatment: its button was enabled the
 * moment a talent profile loaded, and the rejection that followed had nowhere
 * to go. So the reasons live here, in one ordered decision, and both the
 * button and the explanation beside it read the same answer.
 *
 * Order matters. What the viewer is comes before what their profile says,
 * because a guest has no profile to judge, and eligibility comes before the
 * project's remaining seats, because "upload your CV" is the more actionable
 * of two true statements.
 */
export type ApplyGate =
  | 'closed'
  | 'guest'
  | 'not_talent'
  | 'own_project'
  | 'no_profile'
  | 'loading'
  | 'suspended'
  | 'no_cv'
  | 'cv_parsing'
  | 'applied'
  | 'no_seats'
  | 'ready'

export type ApplyGateInput = {
  projectStatus: string
  /** Seats still unassigned. Null when the projection did not carry the field. */
  openPositions: number | null
  ownerId: string | null
  userId: string | null
  userRole: string | null
  profile: { id: string; cvFileUrl: string | null; verificationStatus: string } | null | undefined
  /** The profile request answered 404: this talent has not finished signing up. */
  profileMissing: boolean
  /** A pending or accepted application already exists for this project. */
  hasLiveApplication: boolean
}

export function isOpenToTalent(status: string): boolean {
  return (OPEN_TO_TALENT_STATUSES as readonly string[]).includes(status)
}

export function resolveApplyGate(input: ApplyGateInput): ApplyGate {
  if (!isOpenToTalent(input.projectStatus)) return 'closed'
  if (!input.userId) return 'guest'
  if (input.userRole !== 'talent') return 'not_talent'
  if (input.ownerId === input.userId) return 'own_project'
  if (input.profileMissing) return 'no_profile'
  if (!input.profile) return 'loading'
  if (input.profile.verificationStatus === 'suspended') return 'suspended'
  if (!input.profile.cvFileUrl) return 'no_cv'
  if (input.profile.verificationStatus !== 'verified') return 'cv_parsing'
  if (input.hasLiveApplication) return 'applied'
  if (input.openPositions === 0) return 'no_seats'
  return 'ready'
}

/** Where the notice sends a talent who has something to fix. */
export type ApplyNoticeTo = '/talent/profile' | '/talent/register'

type ApplyNotice = {
  /** Explanation key in the `talent` namespace. */
  key: string
  /** The way out, when there is one. */
  to: ApplyNoticeTo | null
  /** Link label key in the `talent` namespace. */
  action: string | null
}

type ApplyPresentation = {
  /** Label key in the `project` namespace, or null when no button is shown. */
  label: 'apply_project' | 'applied' | null
  notice: ApplyNotice | null
}

/**
 * What each gate puts on screen.
 *
 * A gate that hides the button still speaks: `closed` and `not_talent` say
 * nothing because the page already says it (the status chip, and an owner is
 * not being offered work), while every refusal aimed at this talent carries
 * the reason and, where there is one, the way out.
 */
export const APPLY_PRESENTATION: Record<ApplyGate, ApplyPresentation> = {
  closed: { label: null, notice: null },
  guest: { label: null, notice: null },
  not_talent: { label: null, notice: null },
  own_project: {
    label: null,
    notice: { key: 'apply_own_project', to: null, action: null },
  },
  no_profile: {
    label: null,
    notice: {
      key: 'apply_blocked_no_profile',
      to: '/talent/register',
      action: 'apply_blocked_no_profile_action',
    },
  },
  loading: { label: 'apply_project', notice: null },
  suspended: {
    label: null,
    notice: { key: 'apply_blocked_suspended', to: null, action: null },
  },
  no_cv: {
    label: 'apply_project',
    notice: { key: 'apply_blocked_no_cv', to: '/talent/profile', action: 'apply_blocked_action' },
  },
  cv_parsing: {
    label: 'apply_project',
    notice: {
      key: 'apply_blocked_cv_parsing',
      to: '/talent/profile',
      action: 'apply_blocked_action',
    },
  },
  applied: {
    label: 'applied',
    notice: { key: 'apply_already_applied', to: null, action: null },
  },
  no_seats: {
    label: 'apply_project',
    notice: { key: 'apply_blocked_no_seats', to: null, action: null },
  },
  ready: { label: 'apply_project', notice: null },
}

/**
 * The message a rejected application deserves, keyed by error code.
 *
 * `apiFetch` already localizes every code into `ApiError.message`, so the map
 * only covers the codes whose shared wording is too vague to act on here:
 * CONFLICT reads "data konflik" and VALIDATION_ERROR "data tidak valid", which
 * on this one path mean "you already applied" and "this is your own project".
 * Anything else falls through to the localized message.
 */
export const APPLY_ERROR_KEYS: Record<string, string> = {
  TALENT_CV_REQUIRED: 'apply_blocked_no_cv',
  TALENT_NOT_VERIFIED: 'apply_blocked_cv_parsing',
  TALENT_SUSPENDED: 'apply_blocked_suspended',
  CONFLICT: 'apply_already_applied',
  VALIDATION_ERROR: 'apply_own_project',
  PROJECT_VALIDATION_INVALID_STATUS: 'apply_project_closed',
  AUTH_FORBIDDEN: 'apply_blocked_no_profile',
}

/** Key in the `talent` namespace, or null to use the localized server message. */
export function applyErrorKey(code: string | null | undefined): string | null {
  return APPLY_ERROR_KEYS[code ?? ''] ?? null
}

/**
 * What to tell a talent whose application was refused.
 *
 * `translate` reads the `talent` namespace. A code with a sharper wording wins;
 * otherwise the message stands, already localized by apiFetch. A thrown value
 * that is not an Error at all - a dropped connection surfaces as one, but not
 * everything does - still says something rather than nothing.
 */
export function applyRejectionMessage(err: unknown, translate: (key: string) => string): string {
  const key = err instanceof ApiError ? applyErrorKey(err.code) : null
  if (key) return translate(key)
  if (err instanceof Error && err.message) return err.message
  return translate('apply_error')
}
