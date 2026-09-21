import type { ProjectStatus } from '@kerjacus/shared'
import { createMachine, getInitialSnapshot, getNextSnapshot } from 'xstate'

/**
 * The project lifecycle, as one line with one way off it.
 *
 * draft -> scoping -> brd_review -> prd_review -> matching -> in_progress ->
 * final_review -> completed, and cancelled from anywhere that has not already
 * stopped.
 *
 * Three families of event left with the statuses they targeted:
 *
 * - PURCHASE_BRD/PURCHASE_PRD. A purchase is the document's paid_at and a row
 *   in the ledger, never a position. As a position it was terminal and bricked
 *   paid projects, which is what the previous fix worked around; the status is
 *   gone, so there is nothing left to work around.
 * - START_TEAM_FORMING/COMPLETE_MATCHING/MARK_PARTIALLY_ACTIVE/
 *   RESTORE_FULL_TEAM. Offers being out, every offer accepted and one seat
 *   open are all facts about work packages and assignments. The project is
 *   matching until work starts and in_progress after.
 * - OPEN_DISPUTE/PUT_ON_HOLD/RESUME/RESOLVE_DISPUTE_*. A dispute is an
 *   unresolved row in disputes and a hold is projects.on_hold_at. Neither
 *   moves the project, so neither is a transition; resolving one no longer has
 *   to guess the position back out of the status log.
 */
type ProjectEvent =
  | { type: 'START_SCOPING' }
  | { type: 'GENERATE_BRD' }
  | { type: 'GENERATE_PRD' }
  | { type: 'START_MATCHING' }
  | { type: 'START_PROGRESS' }
  | { type: 'START_REVIEW' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }

// Maps state machine event types to target ProjectStatus values
const EVENT_TO_STATUS: Record<string, ProjectStatus> = {
  START_SCOPING: 'scoping',
  GENERATE_BRD: 'brd_review',
  GENERATE_PRD: 'prd_review',
  START_MATCHING: 'matching',
  START_PROGRESS: 'in_progress',
  START_REVIEW: 'final_review',
  COMPLETE: 'completed',
  CANCEL: 'cancelled',
}

// Maps a target ProjectStatus to the event type needed to reach it from the current state
const STATUS_TO_EVENTS: Record<ProjectStatus, string[]> = {
  draft: [],
  scoping: ['START_SCOPING'],
  brd_review: ['GENERATE_BRD'],
  prd_review: ['GENERATE_PRD'],
  matching: ['START_MATCHING'],
  in_progress: ['START_PROGRESS'],
  final_review: ['START_REVIEW'],
  completed: ['COMPLETE'],
  cancelled: ['CANCEL'],
}

// Transition map: from each state, which states are valid targets
const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['scoping', 'cancelled'],
  scoping: ['brd_review', 'cancelled'],
  brd_review: ['prd_review', 'cancelled'],
  prd_review: ['matching', 'cancelled'],
  matching: ['in_progress', 'cancelled'],
  in_progress: ['final_review', 'cancelled'],
  // Completing is gated on every milestone being approved and the escrow
  // ledger being empty, so a project whose residue cannot be settled needs a
  // second way out or the money stays trapped under a project nobody can
  // close. Cancelling refunds the remaining balance to the owner.
  final_review: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

const projectMachine = createMachine({
  id: 'project',
  initial: 'draft',
  types: {} as {
    events: ProjectEvent
  },
  states: {
    draft: {
      on: {
        START_SCOPING: { target: 'scoping' },
        CANCEL: { target: 'cancelled' },
      },
    },
    scoping: {
      on: {
        GENERATE_BRD: { target: 'brd_review' },
        CANCEL: { target: 'cancelled' },
      },
    },
    brd_review: {
      on: {
        GENERATE_PRD: { target: 'prd_review' },
        CANCEL: { target: 'cancelled' },
      },
    },
    prd_review: {
      on: {
        START_MATCHING: { target: 'matching' },
        CANCEL: { target: 'cancelled' },
      },
    },
    matching: {
      on: {
        START_PROGRESS: { target: 'in_progress' },
        CANCEL: { target: 'cancelled' },
      },
    },
    in_progress: {
      on: {
        START_REVIEW: { target: 'final_review' },
        CANCEL: { target: 'cancelled' },
      },
    },
    final_review: {
      on: {
        COMPLETE: { target: 'completed' },
        CANCEL: { target: 'cancelled' },
      },
    },
    completed: {
      type: 'final',
    },
    cancelled: {
      type: 'final',
    },
  },
})

/**
 * Returns valid target statuses from the given current status.
 */
export function getValidTransitions(currentStatus: ProjectStatus): ProjectStatus[] {
  return VALID_TRANSITIONS[currentStatus] ?? []
}

/**
 * Finds the event type needed to transition from currentStatus to targetStatus.
 * Returns null if the transition is not valid.
 */
export function findTransitionEvent(
  currentStatus: ProjectStatus,
  targetStatus: ProjectStatus,
): string | null {
  const validTargets = VALID_TRANSITIONS[currentStatus]
  if (!validTargets?.includes(targetStatus)) {
    return null
  }

  // The three guards below are defensive against VALID_TRANSITIONS,
  // STATUS_TO_EVENTS and projectMachine drifting out of agreement. With the
  // three in agreement they are unreachable: the only status with no events is
  // `draft`, which is never a valid target, and the only states without an `on`
  // block are the terminals, whose VALID_TRANSITIONS are empty so the caller
  // returns above. Kept as a safety net, excluded from coverage.
  const candidateEvents = STATUS_TO_EVENTS[targetStatus]
  /* v8 ignore next 3 */
  if (!candidateEvents || candidateEvents.length === 0) {
    return null
  }

  // For statuses that can be reached by multiple events, find the one
  // that is valid from the current state
  const stateConfig = projectMachine.config.states?.[currentStatus]
  /* v8 ignore next 3 */
  if (!stateConfig || !('on' in stateConfig) || !stateConfig.on) {
    return null
  }

  const availableEvents = Object.keys(stateConfig.on)
  for (const event of candidateEvents) {
    if (availableEvents.includes(event)) {
      return event
    }
  }

  /* v8 ignore next */
  return null
}

/**
 * Validates whether a transition from currentStatus to targetStatus is valid.
 */
export function isValidTransition(
  currentStatus: ProjectStatus,
  targetStatus: ProjectStatus,
): boolean {
  return findTransitionEvent(currentStatus, targetStatus) !== null
}

/**
 * Validates a transition using XState's actual state machine engine.
 * Returns the event type string if valid, or null if invalid.
 */
export function validateTransitionViaXState(
  currentStatus: ProjectStatus,
  targetStatus: ProjectStatus,
): { valid: true; eventType: string } | { valid: false; eventType: null } {
  const eventType = findTransitionEvent(currentStatus, targetStatus)
  if (!eventType) {
    return { valid: false, eventType: null }
  }

  // Use XState's getNextSnapshot to validate through the actual machine engine
  const initialSnapshot = getInitialSnapshot(projectMachine)
  // Resolve snapshot to the current state by setting value directly
  const resolvedSnapshot = { ...initialSnapshot, value: currentStatus }
  const nextSnapshot = getNextSnapshot(projectMachine, resolvedSnapshot, {
    type: eventType,
  } as unknown as ProjectEvent)

  // If XState transitions to the expected target, it's valid
  if (nextSnapshot.value === targetStatus) {
    return { valid: true, eventType }
  }

  // Unreachable while findTransitionEvent and the machine agree: a resolved
  // event always drives the machine to the target the event maps to. Defensive.
  /* v8 ignore next */
  return { valid: false, eventType: null }
}

export { EVENT_TO_STATUS, STATUS_TO_EVENTS, VALID_TRANSITIONS }
