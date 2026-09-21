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

/** The one path, in order. Every edge below is a step along it. */
const LINE: ProjectStatus[] = [
  'draft',
  'scoping',
  'brd_review',
  'prd_review',
  'matching',
  'in_progress',
  'final_review',
  'completed',
]

describe('Project State Machine', () => {
  describe('isValidTransition', () => {
    it('walks the whole line one step at a time', () => {
      for (let i = 0; i < LINE.length - 1; i += 1) {
        const from = LINE[i]
        const to = LINE[i + 1]
        expect(isValidTransition(from, to), `${from} -> ${to}`).toBe(true)
      }
    })

    it('cancels from anywhere that has not stopped', () => {
      for (const status of LINE.slice(0, -1)) {
        expect(isValidTransition(status, 'cancelled'), status).toBe(true)
      }
    })

    it('refuses every skip over a step', () => {
      for (let i = 0; i < LINE.length; i += 1) {
        for (let j = i + 2; j < LINE.length; j += 1) {
          expect(isValidTransition(LINE[i], LINE[j]), `${LINE[i]} -> ${LINE[j]}`).toBe(false)
        }
      }
    })

    it('refuses every step backwards', () => {
      for (let i = 1; i < LINE.length; i += 1) {
        expect(isValidTransition(LINE[i], LINE[i - 1]), `${LINE[i]} back`).toBe(false)
      }
    })

    /**
     * No self-loops.
     *
     * The collapse turned brd_generated -> brd_approved and matching ->
     * team_forming into moves from a position to itself. They are not
     * transitions any more and must not be offered as one, or the approve and
     * staff handlers would 409 on a project that is exactly where it should
     * be.
     */
    it('refuses a move from a position to itself', () => {
      for (const status of Object.keys(VALID_TRANSITIONS) as ProjectStatus[]) {
        expect(isValidTransition(status, status), status).toBe(false)
      }
    })

    /**
     * disputed and on_hold left the enum.
     *
     * They are conditions - an unresolved disputes row, projects.on_hold_at -
     * and a condition is not somewhere a project goes, so the machine must not
     * offer a way there or back.
     */
    it('knows nothing about the conditions that used to be statuses', () => {
      for (const gone of ['disputed', 'on_hold'] as ProjectStatus[]) {
        expect(VALID_TRANSITIONS[gone]).toBeUndefined()
        expect(isValidTransition('in_progress', gone)).toBe(false)
        expect(isValidTransition('final_review', gone)).toBe(false)
      }
    })

    /** Purchase is paid_at and a ledger row, so it is not a target either. */
    it('knows nothing about the purchases that used to be statuses', () => {
      for (const gone of ['brd_purchased', 'prd_purchased'] as ProjectStatus[]) {
        expect(VALID_TRANSITIONS[gone]).toBeUndefined()
        expect(isValidTransition('brd_review', gone)).toBe(false)
        expect(isValidTransition('prd_review', gone)).toBe(false)
      }
    })
  })

  describe('getValidTransitions', () => {
    it('completed has no transitions', () => {
      expect(getValidTransitions('completed')).toHaveLength(0)
    })

    it('cancelled has no transitions', () => {
      expect(getValidTransitions('cancelled')).toHaveLength(0)
    })

    it('every position except the two terminal ones has exactly one way on and one way out', () => {
      for (const status of LINE.slice(0, -1)) {
        expect(getValidTransitions(status), status).toHaveLength(2)
        expect(getValidTransitions(status), status).toContain('cancelled')
      }
    })

    /**
     * Escrow only ever returns to the owner through a cancellation, so a
     * position that holds money and cannot reach 'cancelled' holds it forever.
     * This is what a purchased project used to fail: brd_purchased was
     * terminal, so paying for a document bricked the project and trapped the
     * escrow with it.
     */
    it('every position that can hold escrow can reach cancelled', () => {
      const holdsEscrow: ProjectStatus[] = [
        'brd_review',
        'prd_review',
        'matching',
        'in_progress',
        'final_review',
      ]
      for (const status of holdsEscrow) {
        expect(getValidTransitions(status), `${status} cannot be cancelled`).toContain('cancelled')
      }
    })

    it('every position except the two terminal ones has a way out', () => {
      const stranded = Object.entries(VALID_TRANSITIONS)
        .filter(([status]) => status !== 'completed' && status !== 'cancelled')
        .filter(([, targets]) => targets.length === 0)
        .map(([status]) => status)
      expect(stranded).toEqual([])
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

    it('finds COMPLETE for final_review to completed', () => {
      expect(findTransitionEvent('final_review', 'completed')).toBe('COMPLETE')
    })

    it('finds START_PROGRESS for matching to in_progress', () => {
      expect(findTransitionEvent('matching', 'in_progress')).toBe('START_PROGRESS')
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
      expect(validateTransitionViaXState('final_review', 'completed')).toEqual({
        valid: true,
        eventType: 'COMPLETE',
      })
      expect(validateTransitionViaXState('matching', 'in_progress')).toEqual({
        valid: true,
        eventType: 'START_PROGRESS',
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
     * the machine are two declarations of the same graph, and a position whose
     * exits were added to one but not the other is still stuck here.
     */
    it('lets a project holding a paid document move on', () => {
      expect(validateTransitionViaXState('brd_review', 'prd_review')).toEqual({
        valid: true,
        eventType: 'GENERATE_PRD',
      })
      expect(validateTransitionViaXState('brd_review', 'cancelled')).toEqual({
        valid: true,
        eventType: 'CANCEL',
      })
      expect(validateTransitionViaXState('prd_review', 'matching')).toEqual({
        valid: true,
        eventType: 'START_MATCHING',
      })
      expect(validateTransitionViaXState('prd_review', 'cancelled')).toEqual({
        valid: true,
        eventType: 'CANCEL',
      })
    })

    it('lets a project in final review be cancelled', () => {
      expect(validateTransitionViaXState('final_review', 'cancelled')).toEqual({
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
    it('covers all 9 project positions', () => {
      expect(Object.keys(VALID_TRANSITIONS)).toHaveLength(9)
    })

    it('declares them in lifecycle order, cancelled last', () => {
      expect(Object.keys(VALID_TRANSITIONS)).toEqual([...LINE, 'cancelled'])
    })
  })

  describe('EVENT_TO_STATUS', () => {
    it('maps events to status values', () => {
      expect(EVENT_TO_STATUS.START_SCOPING).toBe('scoping')
      expect(EVENT_TO_STATUS.COMPLETE).toBe('completed')
      expect(EVENT_TO_STATUS.CANCEL).toBe('cancelled')
    })

    /**
     * One event per position, and no event for a position that is no longer
     * one. A leftover PURCHASE_BRD or OPEN_DISPUTE would name a target the
     * enum cannot hold, and the transition endpoint would 500 on the cast
     * rather than refuse the request.
     */
    it('names no target the enum does not have', () => {
      const positions = new Set(Object.keys(VALID_TRANSITIONS))
      for (const [event, target] of Object.entries(EVENT_TO_STATUS)) {
        expect(positions.has(target), `${event} -> ${target}`).toBe(true)
      }
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

    /**
     * One way in per position.
     *
     * in_progress used to be reachable by four events - START_PROGRESS,
     * RESTORE_FULL_TEAM, RESUME and RESOLVE_DISPUTE_CONTINUE - because three
     * of them were ways back from a condition. Work starts once.
     */
    it('reaches every other position by exactly one event', () => {
      for (const status of Object.keys(VALID_TRANSITIONS) as ProjectStatus[]) {
        if (status === 'draft') continue
        expect(STATUS_TO_EVENTS[status], status).toHaveLength(1)
      }
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
   * PRD_GENERATION_STATUSES is the position half of the precondition
   * generate-prd and the PRD revision enforce, and the PRD page greys its
   * button on. It is a literal list because the browser needs it too and the
   * machine lives here, so it is held against the machine rather than trusted:
   * every position GENERATE_PRD can fire from must be in it.
   *
   * The other half is the document's own status, which is where the approval
   * moved when brd_review swallowed brd_generated and brd_approved.
   */
  describe('PRD generation precondition', () => {
    const statuses = Object.keys(VALID_TRANSITIONS) as ProjectStatus[]

    it('covers every position the machine lets a PRD be generated from', () => {
      const fromMachine = statuses.filter((s) => isValidTransition(s, 'prd_review'))
      expect(fromMachine).toEqual(['brd_review'])
      for (const status of fromMachine) {
        expect(PRD_GENERATION_STATUSES, status).toContain(status)
      }
    })

    it('admits no position that has no BRD at all', () => {
      for (const status of ['draft', 'scoping'] as ProjectStatus[]) {
        expect(isValidTransition(status, 'prd_review')).toBe(false)
        expect(PRD_GENERATION_STATUSES, status).not.toContain(status)
      }
    })

    /** Regeneration and revision stay open while the PRD is the open decision. */
    it('adds only prd_review itself on top of the machine edges', () => {
      const fromMachine = statuses.filter((s) => isValidTransition(s, 'prd_review'))
      const extra = PRD_GENERATION_STATUSES.filter((s) => !fromMachine.includes(s))
      expect(extra).toEqual(['prd_review'])
    })
  })
})
