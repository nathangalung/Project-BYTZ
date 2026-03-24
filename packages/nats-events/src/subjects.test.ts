import { describe, expect, it } from 'vitest'
import {
  AI_SUBJECTS,
  CHAT_SUBJECTS,
  DLQ_PREFIX,
  MILESTONE_SUBJECTS,
  PAYMENT_SUBJECTS,
  PROJECT_SUBJECTS,
  SYSTEM_SUBJECTS,
  TALENT_SUBJECTS,
} from './subjects'

describe('PROJECT_SUBJECTS', () => {
  it('uses dot notation for all subjects', () => {
    for (const subject of Object.values(PROJECT_SUBJECTS)) {
      expect(subject).toMatch(/^project\./)
    }
  })

  it('has all lifecycle events', () => {
    expect(PROJECT_SUBJECTS.CREATED).toBe('project.created')
    expect(PROJECT_SUBJECTS.STATUS_CHANGED).toBe('project.status.changed')
    expect(PROJECT_SUBJECTS.COMPLETED).toBe('project.completed')
    expect(PROJECT_SUBJECTS.CANCELLED).toBe('project.cancelled')
    expect(PROJECT_SUBJECTS.DISPUTED).toBe('project.disputed')
    expect(PROJECT_SUBJECTS.ON_HOLD).toBe('project.on_hold')
    expect(PROJECT_SUBJECTS.RESUMED).toBe('project.resumed')
  })

  it('has team events', () => {
    expect(PROJECT_SUBJECTS.TEAM_FORMING).toBe('project.team.forming')
    expect(PROJECT_SUBJECTS.TEAM_TALENT_ASSIGNED).toBe('project.team.talent_assigned')
    expect(PROJECT_SUBJECTS.TEAM_TALENT_REPLACED).toBe('project.team.talent_replaced')
    expect(PROJECT_SUBJECTS.TEAM_COMPLETE).toBe('project.team.complete')
  })

  it('has 11 subjects', () => {
    expect(Object.keys(PROJECT_SUBJECTS)).toHaveLength(11)
  })
})

describe('PAYMENT_SUBJECTS', () => {
  it('uses dot notation for all subjects', () => {
    for (const subject of Object.values(PAYMENT_SUBJECTS)) {
      expect(subject).toMatch(/^payment\./)
    }
  })

  it('has all payment events', () => {
    expect(PAYMENT_SUBJECTS.ESCROW_CREATED).toBe('payment.escrow.created')
    expect(PAYMENT_SUBJECTS.RELEASED).toBe('payment.released')
    expect(PAYMENT_SUBJECTS.REFUNDED).toBe('payment.refunded')
    expect(PAYMENT_SUBJECTS.PARTIAL_REFUND).toBe('payment.partial_refund')
    expect(PAYMENT_SUBJECTS.REVISION_FEE_CHARGED).toBe('payment.revision_fee.charged')
    expect(PAYMENT_SUBJECTS.TALENT_PLACEMENT_FEE_CHARGED).toBe(
      'payment.talent_placement_fee.charged',
    )
    expect(PAYMENT_SUBJECTS.GATEWAY_WEBHOOK_RECEIVED).toBe('payment.gateway.webhook_received')
  })

  it('has 7 subjects', () => {
    expect(Object.keys(PAYMENT_SUBJECTS)).toHaveLength(7)
  })
})

describe('TALENT_SUBJECTS', () => {
  it('uses dot notation for all subjects', () => {
    for (const subject of Object.values(TALENT_SUBJECTS)) {
      expect(subject).toMatch(/^talent\./)
    }
  })

  it('has all talent events', () => {
    expect(TALENT_SUBJECTS.REGISTERED).toBe('talent.registered')
    expect(TALENT_SUBJECTS.VERIFIED).toBe('talent.verified')
    expect(TALENT_SUBJECTS.SUSPENDED).toBe('talent.suspended')
    expect(TALENT_SUBJECTS.UNSUSPENDED).toBe('talent.unsuspended')
    expect(TALENT_SUBJECTS.ASSIGNMENT_ACCEPTED).toBe('talent.assignment.accepted')
    expect(TALENT_SUBJECTS.ASSIGNMENT_DECLINED).toBe('talent.assignment.declined')
  })

  it('has 6 subjects', () => {
    expect(Object.keys(TALENT_SUBJECTS)).toHaveLength(6)
  })
})

describe('MILESTONE_SUBJECTS', () => {
  it('uses dot notation for all subjects', () => {
    for (const subject of Object.values(MILESTONE_SUBJECTS)) {
      expect(subject).toMatch(/^milestone\./)
    }
  })

  it('has all milestone events', () => {
    expect(MILESTONE_SUBJECTS.SUBMITTED).toBe('milestone.submitted')
    expect(MILESTONE_SUBJECTS.APPROVED).toBe('milestone.approved')
    expect(MILESTONE_SUBJECTS.REJECTED).toBe('milestone.rejected')
    expect(MILESTONE_SUBJECTS.REVISION_REQUESTED).toBe('milestone.revision_requested')
    expect(MILESTONE_SUBJECTS.AUTO_RELEASED).toBe('milestone.auto_released')
    expect(MILESTONE_SUBJECTS.OVERDUE).toBe('milestone.overdue')
    expect(MILESTONE_SUBJECTS.DUE_SOON).toBe('milestone.due_soon')
    expect(MILESTONE_SUBJECTS.DEPENDENCY_BLOCKED).toBe('milestone.dependency.blocked')
  })

  it('has 8 subjects', () => {
    expect(Object.keys(MILESTONE_SUBJECTS)).toHaveLength(8)
  })
})

describe('CHAT_SUBJECTS', () => {
  it('uses dot notation', () => {
    expect(CHAT_SUBJECTS.MESSAGE_SENT).toBe('chat.message.sent')
    expect(CHAT_SUBJECTS.BYPASS_DETECTED).toBe('chat.bypass_detected')
  })
})

describe('AI_SUBJECTS', () => {
  it('uses dot notation', () => {
    expect(AI_SUBJECTS.BRD_GENERATED).toBe('ai.brd.generated')
    expect(AI_SUBJECTS.PRD_GENERATED).toBe('ai.prd.generated')
    expect(AI_SUBJECTS.CV_PARSED).toBe('ai.cv.parsed')
    expect(AI_SUBJECTS.MATCHING_COMPLETED).toBe('ai.matching.completed')
  })
})

describe('SYSTEM_SUBJECTS', () => {
  it('has notification and admin events', () => {
    expect(SYSTEM_SUBJECTS.NOTIFICATION_SEND).toBe('notification.send')
    expect(SYSTEM_SUBJECTS.ADMIN_ACTION_PERFORMED).toBe('admin.action.performed')
  })
})

describe('DLQ_PREFIX', () => {
  it('is dlq', () => {
    expect(DLQ_PREFIX).toBe('dlq')
  })
})
