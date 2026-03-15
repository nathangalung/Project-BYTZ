import { describe, expect, it } from 'vitest'
import {
  EVENT_TO_STATUS,
  findTransitionEvent,
  getValidTransitions,
  isValidTransition,
  STATUS_TO_EVENTS,
  VALID_TRANSITIONS,
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

    it('brd_purchased has no transitions', () => {
      const transitions = getValidTransitions('brd_purchased')
      expect(transitions).toHaveLength(0)
    })

    it('prd_purchased has no transitions', () => {
      const transitions = getValidTransitions('prd_purchased')
      expect(transitions).toHaveLength(0)
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
})
