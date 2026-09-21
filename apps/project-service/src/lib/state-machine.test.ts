import { PRD_GENERATION_STATUSES, type ProjectStatus } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import {
  EVENT_TO_STATUS,
  findTransitionEvent,
  getValidTransitions,
  isValidTransition,
  STATUS_TO_EVENTS,
  VALID_TRANSITIONS,
  validateTransitionViaXState,
} from './state-machine'

describe('Project State Machine', () => {
  describe('isValidTransition', () => {
    it('draft can transition to scoping', () => {
      expect(isValidTransition('draft', 'scoping')).toBe(true)
    })

    it('draft can be cancelled', () => {
      expect(isValidTransition('draft', 'cancelled')).toBe(true)
    })

    it('draft cannot skip to in_progress', () => {
      expect(isValidTransition('draft', 'in_progress')).toBe(false)
    })

    it('draft cannot go to completed', () => {
      expect(isValidTransition('draft', 'completed')).toBe(false)
    })

    it('scoping goes to brd_generated', () => {
      expect(isValidTransition('scoping', 'brd_generated')).toBe(true)
    })

    it('brd_generated goes to brd_approved', () => {
      expect(isValidTransition('brd_generated', 'brd_approved')).toBe(true)
    })

    it('brd_approved can purchase BRD', () => {
      expect(isValidTransition('brd_approved', 'brd_purchased')).toBe(true)
    })

    it('brd_approved can generate PRD', () => {
      expect(isValidTransition('brd_approved', 'prd_generated')).toBe(true)
    })

    it('prd_approved can start matching', () => {
      expect(isValidTransition('prd_approved', 'matching')).toBe(true)
    })

    it('prd_approved can purchase PRD', () => {
      expect(isValidTransition('prd_approved', 'prd_purchased')).toBe(true)
    })

    it('matching can go to team_forming', () => {
      expect(isValidTransition('matching', 'team_forming')).toBe(true)
    })

    it('matching can go directly to matched', () => {
      expect(isValidTransition('matching', 'matched')).toBe(true)
    })

    it('team_forming goes to matched', () => {
      expect(isValidTransition('team_forming', 'matched')).toBe(true)
    })

    it('matched goes to in_progress', () => {
      expect(isValidTransition('matched', 'in_progress')).toBe(true)
    })

    it('in_progress can go to review', () => {
      expect(isValidTransition('in_progress', 'review')).toBe(true)
    })

    it('in_progress can be disputed', () => {
      expect(isValidTransition('in_progress', 'disputed')).toBe(true)
    })

    it('in_progress can be put on hold', () => {
      expect(isValidTransition('in_progress', 'on_hold')).toBe(true)
    })

    it('in_progress can be partially active', () => {
      expect(isValidTransition('in_progress', 'partially_active')).toBe(true)
    })

    it('partially_active can restore to in_progress', () => {
      expect(isValidTransition('partially_active', 'in_progress')).toBe(true)
    })

    it('partially_active can go to review', () => {
      expect(isValidTransition('partially_active', 'review')).toBe(true)
    })

    it('review goes to completed', () => {
      expect(isValidTransition('review', 'completed')).toBe(true)
    })

    it('review can be disputed', () => {
      expect(isValidTransition('review', 'disputed')).toBe(true)
    })

    it('on_hold can resume to in_progress', () => {
      expect(isValidTransition('on_hold', 'in_progress')).toBe(true)
    })

    it('on_hold can be cancelled', () => {
      expect(isValidTransition('on_hold', 'cancelled')).toBe(true)
    })

    it('on_hold can be disputed', () => {
      expect(isValidTransition('on_hold', 'disputed')).toBe(true)
    })

    it('disputed can resolve to in_progress', () => {
      expect(isValidTransition('disputed', 'in_progress')).toBe(true)
    })

    it('disputed can resolve to cancelled', () => {
      expect(isValidTransition('disputed', 'cancelled')).toBe(true)
    })

    it('disputed can resolve to completed', () => {
      expect(isValidTransition('disputed', 'completed')).toBe(true)
    })
  })

  describe('getValidTransitions', () => {
    it('completed has no transitions', () => {
      const transitions = getValidTransitions('completed')
      expect(transitions).toHaveLength(0)
    })

    it('cancelled has no transitions', () => {
      const transitions = getValidTransitions('cancelled')
      expect(transitions).toHaveLength(0)
    })

    /**
     * Both purchase statuses used to be terminal, and a project that reached
     * one was bricked: no forward edge, and no edge to 'cancelled' either,
     * which is the only transition that refunds the escrow. Not even an admin
     * could move it. The exits are what make the status a milestone rather
     * than a grave, so they are asserted by name.
     */
    it('brd_purchased can continue to the PRD or be cancelled', () => {
      const transitions = getValidTransitions('brd_purchased')
      expect(transitions).toContain('prd_generated')
      expect(transitions).toContain('cancelled')
      expect(transitions).toHaveLength(2)
    })

    it('prd_purchased can continue to matching or be cancelled', () => {
      const transitions = getValidTransitions('prd_purchased')
      expect(transitions).toContain('matching')
      expect(transitions).toContain('cancelled')
      expect(transitions).toHaveLength(2)
    })

    /**
     * Completing is gated on every milestone being approved and the escrow
     * ledger being empty. A project that cannot satisfy that needs a second
     * exit, or the money it holds has nowhere to go.
     */
    it('review can be cancelled as well as completed or disputed', () => {
      const transitions = getValidTransitions('review')
      expect(transitions).toContain('completed')
      expect(transitions).toContain('disputed')
      expect(transitions).toContain('cancelled')
      expect(transitions).toHaveLength(3)
    })

    it('every status except the two terminal ones has a way out', () => {
      const stranded = Object.entries(VALID_TRANSITIONS)
        .filter(([status]) => status !== 'completed' && status !== 'cancelled')
        .filter(([, targets]) => targets.length === 0)
        .map(([status]) => status)
      expect(stranded).toEqual([])
    })

    /**
     * Escrow only ever returns to the owner through a cancellation, so a
     * status that holds money and cannot reach 'cancelled' holds it forever.
     */
    it('every status that can hold escrow can reach cancelled', () => {
      const holdsEscrow: ProjectStatus[] = [
        'prd_approved',
        'prd_purchased',
        'matching',
        'team_forming',
        'matched',
        'in_progress',
        'partially_active',
        'review',
        'on_hold',
        'disputed',
      ]
      for (const status of holdsEscrow) {
        expect(getValidTransitions(status), `${status} cannot be cancelled`).toContain('cancelled')
      }
    })

    it('brd_approved has 3 exits', () => {
      const transitions = getValidTransitions('brd_approved')
      expect(transitions).toContain('brd_purchased')
      expect(transitions).toContain('prd_generated')
      expect(transitions).toContain('cancelled')
      expect(transitions).toHaveLength(3)
    })

    it('in_progress has 5 exits', () => {
      const transitions = getValidTransitions('in_progress')
      expect(transitions).toContain('partially_active')
      expect(transitions).toContain('review')
      expect(transitions).toContain('cancelled')
      expect(transitions).toContain('disputed')
      expect(transitions).toContain('on_hold')
      expect(transitions).toHaveLength(5)
    })

    it('draft has 2 exits', () => {
      const transitions = getValidTransitions('draft')
      expect(transitions).toContain('scoping')
      expect(transitions).toContain('cancelled')
      expect(transitions).toHaveLength(2)
    })

    it('disputed has 3 exits', () => {
      const transitions = getValidTransitions('disputed')
      expect(transitions).toHaveLength(3)
    })

    it('on_hold has 3 exits', () => {
      const transitions = getValidTransitions('on_hold')
      expect(transitions).toHaveLength(3)
    })
  })

  describe('findTransitionEvent', () => {
    it('finds START_SCOPING for draft to scoping', () => {
      expect(findTransitionEvent('draft', 'scoping')).toBe('START_SCOPING')
    })

    it('finds CANCEL for draft to cancelled', () => {
      expect(findTransitionEvent('draft', 'cancelled')).toBe('CANCEL')
    })

    it('returns null for invalid transition', () => {
      expect(findTransitionEvent('draft', 'completed')).toBeNull()
    })

    it('finds COMPLETE for review to completed', () => {
      expect(findTransitionEvent('review', 'completed')).toBe('COMPLETE')
    })

    it('finds RESUME for on_hold to in_progress', () => {
      expect(findTransitionEvent('on_hold', 'in_progress')).toBe('RESUME')
    })

    it('finds RESOLVE_DISPUTE_CONTINUE for disputed to in_progress', () => {
      expect(findTransitionEvent('disputed', 'in_progress')).toBe('RESOLVE_DISPUTE_CONTINUE')
    })
  })

  /**
   * The validator every live transition actually runs through.
   *
   * ProjectService.transitionStatus calls this one, not isValidTransition, and
   * nothing tested it. It resolves the current state by overwriting `value` on
   * a fresh snapshot, so whether XState answers from that or from the node
   * list the snapshot was built with is the difference between the table being
   * enforced and every transition out of a non-draft status being refused.
   */
  describe('validateTransitionViaXState', () => {
    it('agrees with the table on a plain edge', () => {
      expect(validateTransitionViaXState('draft', 'scoping')).toEqual({
        valid: true,
        eventType: 'START_SCOPING',
      })
    })

    /**
     * draft is where the snapshot starts, so an edge out of any other status
     * is the case that proves the resolved state is the one being evaluated.
     */
    it('resolves states other than the initial one', () => {
      expect(validateTransitionViaXState('review', 'completed')).toEqual({
        valid: true,
        eventType: 'COMPLETE',
      })
      expect(validateTransitionViaXState('matched', 'in_progress')).toEqual({
        valid: true,
        eventType: 'START_PROGRESS',
      })
    })

    /** in_progress is reachable by four events; the right one is per source. */
    it('picks the event the current state actually offers', () => {
      expect(validateTransitionViaXState('on_hold', 'in_progress')).toEqual({
        valid: true,
        eventType: 'RESUME',
      })
      expect(validateTransitionViaXState('disputed', 'in_progress')).toEqual({
        valid: true,
        eventType: 'RESOLVE_DISPUTE_CONTINUE',
      })
      expect(validateTransitionViaXState('partially_active', 'in_progress')).toEqual({
        valid: true,
        eventType: 'RESTORE_FULL_TEAM',
      })
    })

    it('refuses a transition the table does not have', () => {
      expect(validateTransitionViaXState('draft', 'completed')).toEqual({
        valid: false,
        eventType: null,
      })
      expect(validateTransitionViaXState('completed', 'in_progress')).toEqual({
        valid: false,
        eventType: null,
      })
    })

    /**
     * The dead-end fix has to hold on this path specifically: the table and
     * the machine are two declarations of the same graph, and a status whose
     * exits were added to one but not the other is still stuck here.
     */
    it('lets a purchased project move on', () => {
      expect(validateTransitionViaXState('brd_purchased', 'prd_generated')).toEqual({
        valid: true,
        eventType: 'GENERATE_PRD',
      })
      expect(validateTransitionViaXState('brd_purchased', 'cancelled')).toEqual({
        valid: true,
        eventType: 'CANCEL',
      })
      expect(validateTransitionViaXState('prd_purchased', 'matching')).toEqual({
        valid: true,
        eventType: 'START_MATCHING',
      })
      expect(validateTransitionViaXState('prd_purchased', 'cancelled')).toEqual({
        valid: true,
        eventType: 'CANCEL',
      })
    })

    it('lets a project in review be cancelled', () => {
      expect(validateTransitionViaXState('review', 'cancelled')).toEqual({
        valid: true,
        eventType: 'CANCEL',
      })
    })

    it('refuses everything out of a status the table does not know', () => {
      expect(validateTransitionViaXState('archived' as ProjectStatus, 'cancelled')).toEqual({
        valid: false,
        eventType: null,
      })
    })

    /**
     * Two declarations of one graph. Walking the table through the engine is
     * the only thing that catches an edge added to VALID_TRANSITIONS and not
     * to the machine - which reads as a legal move right up until the live
     * validator refuses it.
     */
    it('accepts every edge the table declares', () => {
      for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
        for (const to of targets) {
          const result = validateTransitionViaXState(from as ProjectStatus, to)
          expect(result.valid, `${from} -> ${to} is in the table but the machine refuses it`).toBe(
            true,
          )
        }
      }
    })
  })

  describe('VALID_TRANSITIONS map', () => {
    it('covers all 18 project statuses', () => {
      expect(Object.keys(VALID_TRANSITIONS)).toHaveLength(18)
    })
  })

  describe('EVENT_TO_STATUS', () => {
    it('maps events to status values', () => {
      expect(EVENT_TO_STATUS.START_SCOPING).toBe('scoping')
      expect(EVENT_TO_STATUS.COMPLETE).toBe('completed')
      expect(EVENT_TO_STATUS.CANCEL).toBe('cancelled')
    })
  })

  describe('STATUS_TO_EVENTS', () => {
    it('maps statuses to events', () => {
      expect(STATUS_TO_EVENTS.scoping).toContain('START_SCOPING')
      expect(STATUS_TO_EVENTS.completed).toContain('COMPLETE')
    })

    it('draft has no events leading to it', () => {
      expect(STATUS_TO_EVENTS.draft).toHaveLength(0)
    })

    it('in_progress has multiple events', () => {
      expect(STATUS_TO_EVENTS.in_progress.length).toBeGreaterThan(1)
    })
  })

  /**
   * status is a database enum and this table is TypeScript, so the two can
   * disagree in one direction: a migration adds a value and ships before the
   * code that knows it, and every deployed replica then reads rows carrying a
   * status no key here matches. The cast below is that row, not a caller a
   * type checker would have caught.
   *
   * Answering "no transitions" is what makes such a project inert rather than
   * crashing the status endpoint for everyone holding one.
   */
  describe('a status the table does not know', () => {
    const unknown = 'archived' as ProjectStatus

    it('offers no transitions rather than throwing on undefined', () => {
      expect(getValidTransitions(unknown)).toEqual([])
    })

    it('refuses every transition out of it', () => {
      expect(isValidTransition(unknown, 'cancelled')).toBe(false)
      expect(findTransitionEvent(unknown, 'cancelled')).toBeNull()
    })

    it('refuses every transition into it', () => {
      expect(isValidTransition('draft', unknown)).toBe(false)
    })
  })

  /**
   * PRD_GENERATION_STATUSES is the precondition generate-prd and the PRD
   * revision enforce, and the PRD page greys its button on. It is a literal
   * list because the browser needs it too and the machine lives here, so it is
   * held against the machine rather than trusted: every state GENERATE_PRD can
   * fire from must be in it, and no state that still owes a BRD approval may
   * be. A new edge into prd_generated that forgets the list fails here.
   */
  describe('PRD generation precondition', () => {
    const statuses = Object.keys(VALID_TRANSITIONS) as ProjectStatus[]

    it('covers every state the machine lets a PRD be generated from', () => {
      const fromMachine = statuses.filter((s) => isValidTransition(s, 'prd_generated'))
      expect(fromMachine).not.toHaveLength(0)
      for (const status of fromMachine) {
        expect(PRD_GENERATION_STATUSES, status).toContain(status)
      }
    })

    it('admits no state that has not passed the BRD approval', () => {
      for (const status of ['draft', 'scoping', 'brd_generated'] as ProjectStatus[]) {
        expect(isValidTransition(status, 'prd_generated')).toBe(false)
        expect(PRD_GENERATION_STATUSES, status).not.toContain(status)
      }
    })

    /** Regeneration and revision stay open while the PRD is the open decision. */
    it('adds only the three PRD states on top of the machine edges', () => {
      const fromMachine = statuses.filter((s) => isValidTransition(s, 'prd_generated'))
      const extra = PRD_GENERATION_STATUSES.filter((s) => !fromMachine.includes(s))
      expect(extra).toEqual(['prd_generated', 'prd_approved', 'prd_purchased'])
    })
  })
})
