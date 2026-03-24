import type { ProjectStatus } from '@kerjacus/shared'
import { createMachine, getInitialSnapshot, getNextSnapshot } from 'xstate'

type ProjectEvent =
  | { type: 'START_SCOPING' }
  | { type: 'GENERATE_BRD' }
  | { type: 'APPROVE_BRD' }
  | { type: 'PURCHASE_BRD' }
  | { type: 'GENERATE_PRD' }
  | { type: 'APPROVE_PRD' }
  | { type: 'PURCHASE_PRD' }
  | { type: 'START_MATCHING' }
  | { type: 'START_TEAM_FORMING' }
  | { type: 'COMPLETE_MATCHING' }
  | { type: 'START_PROGRESS' }
  | { type: 'MARK_PARTIALLY_ACTIVE' }
  | { type: 'RESTORE_FULL_TEAM' }
  | { type: 'START_REVIEW' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }
  | { type: 'OPEN_DISPUTE' }
  | { type: 'PUT_ON_HOLD' }
  | { type: 'RESUME' }
  | { type: 'RESOLVE_DISPUTE_CONTINUE' }
  | { type: 'RESOLVE_DISPUTE_CANCEL' }
  | { type: 'RESOLVE_DISPUTE_COMPLETE' }

// Maps state machine event types to target ProjectStatus values
const EVENT_TO_STATUS: Record<string, ProjectStatus> = {
  START_SCOPING: 'scoping',
  GENERATE_BRD: 'brd_generated',
  APPROVE_BRD: 'brd_approved',
  PURCHASE_BRD: 'brd_purchased',
  GENERATE_PRD: 'prd_generated',
  APPROVE_PRD: 'prd_approved',
  PURCHASE_PRD: 'prd_purchased',
  START_MATCHING: 'matching',
  START_TEAM_FORMING: 'team_forming',
  COMPLETE_MATCHING: 'matched',
  START_PROGRESS: 'in_progress',
  MARK_PARTIALLY_ACTIVE: 'partially_active',
  RESTORE_FULL_TEAM: 'in_progress',
  START_REVIEW: 'review',
  COMPLETE: 'completed',
  CANCEL: 'cancelled',
  OPEN_DISPUTE: 'disputed',
  PUT_ON_HOLD: 'on_hold',
  RESUME: 'in_progress',
  RESOLVE_DISPUTE_CONTINUE: 'in_progress',
  RESOLVE_DISPUTE_CANCEL: 'cancelled',
  RESOLVE_DISPUTE_COMPLETE: 'completed',
}

// Maps a target ProjectStatus to the event type needed to reach it from the current state
const STATUS_TO_EVENTS: Record<ProjectStatus, string[]> = {
  draft: [],
  scoping: ['START_SCOPING'],
  brd_generated: ['GENERATE_BRD'],
  brd_approved: ['APPROVE_BRD'],
  brd_purchased: ['PURCHASE_BRD'],
  prd_generated: ['GENERATE_PRD'],
  prd_approved: ['APPROVE_PRD'],
  prd_purchased: ['PURCHASE_PRD'],
  matching: ['START_MATCHING'],
  team_forming: ['START_TEAM_FORMING'],
  matched: ['COMPLETE_MATCHING'],
  in_progress: ['START_PROGRESS', 'RESTORE_FULL_TEAM', 'RESUME', 'RESOLVE_DISPUTE_CONTINUE'],
  partially_active: ['MARK_PARTIALLY_ACTIVE'],
  review: ['START_REVIEW'],
  completed: ['COMPLETE', 'RESOLVE_DISPUTE_COMPLETE'],
  cancelled: ['CANCEL', 'RESOLVE_DISPUTE_CANCEL'],
  disputed: ['OPEN_DISPUTE'],
  on_hold: ['PUT_ON_HOLD'],
}

// Transition map: from each state, which states are valid targets
const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['scoping', 'cancelled'],
  scoping: ['brd_generated', 'cancelled'],
  brd_generated: ['brd_approved', 'cancelled'],
  brd_approved: ['brd_purchased', 'prd_generated', 'cancelled'],
  brd_purchased: [],
  prd_generated: ['prd_approved', 'cancelled'],
  prd_approved: ['prd_purchased', 'matching', 'cancelled'],
  prd_purchased: [],
  matching: ['team_forming', 'matched', 'cancelled'],
  team_forming: ['matched', 'cancelled'],
  matched: ['in_progress', 'cancelled'],
  in_progress: ['partially_active', 'review', 'cancelled', 'disputed', 'on_hold'],
  partially_active: ['in_progress', 'cancelled', 'disputed', 'review'],
  review: ['completed', 'disputed'],
  completed: [],
  cancelled: [],
  disputed: ['in_progress', 'cancelled', 'completed'],
  on_hold: ['in_progress', 'cancelled', 'disputed'],
}

export const projectMachine = createMachine({
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
        GENERATE_BRD: { target: 'brd_generated' },
        CANCEL: { target: 'cancelled' },
      },
    },
    brd_generated: {
      on: {
        APPROVE_BRD: { target: 'brd_approved' },
        CANCEL: { target: 'cancelled' },
      },
    },
    brd_approved: {
      on: {
        PURCHASE_BRD: { target: 'brd_purchased' },
        GENERATE_PRD: { target: 'prd_generated' },
        CANCEL: { target: 'cancelled' },
      },
    },
    brd_purchased: {
      type: 'final',
    },
    prd_generated: {
      on: {
        APPROVE_PRD: { target: 'prd_approved' },
        CANCEL: { target: 'cancelled' },
      },
    },
    prd_approved: {
      on: {
        PURCHASE_PRD: { target: 'prd_purchased' },
        START_MATCHING: { target: 'matching' },
        CANCEL: { target: 'cancelled' },
      },
    },
    prd_purchased: {
      type: 'final',
    },
    matching: {
      on: {
        START_TEAM_FORMING: { target: 'team_forming' },
        COMPLETE_MATCHING: { target: 'matched' },
        CANCEL: { target: 'cancelled' },
      },
    },
    team_forming: {
      on: {
        COMPLETE_MATCHING: { target: 'matched' },
        CANCEL: { target: 'cancelled' },
      },
    },
    matched: {
      on: {
        START_PROGRESS: { target: 'in_progress' },
        CANCEL: { target: 'cancelled' },
      },
    },
    in_progress: {
      on: {
        MARK_PARTIALLY_ACTIVE: { target: 'partially_active' },
        START_REVIEW: { target: 'review' },
        CANCEL: { target: 'cancelled' },
        OPEN_DISPUTE: { target: 'disputed' },
        PUT_ON_HOLD: { target: 'on_hold' },
      },
    },
    partially_active: {
      on: {
        RESTORE_FULL_TEAM: { target: 'in_progress' },
        CANCEL: { target: 'cancelled' },
        OPEN_DISPUTE: { target: 'disputed' },
        START_REVIEW: { target: 'review' },
      },
    },
    review: {
      on: {
        COMPLETE: { target: 'completed' },
        OPEN_DISPUTE: { target: 'disputed' },
      },
    },
    completed: {
      type: 'final',
    },
    cancelled: {
      type: 'final',
    },
    disputed: {
      on: {
        RESOLVE_DISPUTE_CONTINUE: { target: 'in_progress' },
        RESOLVE_DISPUTE_CANCEL: { target: 'cancelled' },
        RESOLVE_DISPUTE_COMPLETE: { target: 'completed' },
      },
    },
    on_hold: {
      on: {
        RESUME: { target: 'in_progress' },
        CANCEL: { target: 'cancelled' },
        OPEN_DISPUTE: { target: 'disputed' },
      },
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

  const candidateEvents = STATUS_TO_EVENTS[targetStatus]
  if (!candidateEvents || candidateEvents.length === 0) {
    return null
  }

  // For statuses that can be reached by multiple events, find the one
  // that is valid from the current state
  const stateConfig = projectMachine.config.states?.[currentStatus]
  if (!stateConfig || !('on' in stateConfig) || !stateConfig.on) {
    return null
  }

  const availableEvents = Object.keys(stateConfig.on)
  for (const event of candidateEvents) {
    if (availableEvents.includes(event)) {
      return event
    }
  }

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

  return { valid: false, eventType: null }
}

export type { ProjectEvent }
export { EVENT_TO_STATUS, STATUS_TO_EVENTS, VALID_TRANSITIONS }
