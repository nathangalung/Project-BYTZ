// Project lifecycle events
export const PROJECT_SUBJECTS = {
  CREATED: 'project.created',
  STATUS_CHANGED: 'project.status.changed',
  COMPLETED: 'project.completed',
  CANCELLED: 'project.cancelled',
  DISPUTED: 'project.disputed',
  ON_HOLD: 'project.on_hold',
  RESUMED: 'project.resumed',
  TEAM_FORMING: 'project.team.forming',
  TEAM_TALENT_ASSIGNED: 'project.team.talent_assigned',
  TEAM_TALENT_REPLACED: 'project.team.talent_replaced',
  TEAM_COMPLETE: 'project.team.complete',
  TEAM_ESCALATED: 'project.team.escalated',
} as const

// status.* mirror the application_status enum.
/**
 * An application decision is the owner answering an applicant. It is not the
 * talent.assignment.* pair, which means a hired talent took or left the work
 * and which notification-service reads as news for the owner.
 */
export const APPLICATION_SUBJECTS = {
  CREATED: 'application.created',
  STATUS_PENDING: 'application.status.pending',
  STATUS_ACCEPTED: 'application.status.accepted',
  STATUS_REJECTED: 'application.status.rejected',
  STATUS_WITHDRAWN: 'application.status.withdrawn',
} as const

export const WORK_PACKAGE_SUBJECTS = {
  CREATED: 'work_package.created',
  STATUS_CHANGED: 'work_package.status_changed',
} as const

export const CONTRACT_SUBJECTS = {
  CREATED: 'contract.created',
  SIGNED: 'contract.signed',
  FULLY_EXECUTED: 'contract.fully_executed',
} as const

// phase.* are the three escalation steps of dispute resolution.
export const DISPUTE_SUBJECTS = {
  CREATED: 'dispute.created',
  STATUS_CHANGED: 'dispute.status_changed',
  RESOLVED: 'dispute.resolved',
  PHASE_DIRECT: 'dispute.phase.direct',
  PHASE_MEDIATION: 'dispute.phase.mediation',
  PHASE_BINDING: 'dispute.phase.binding',
} as const

export const REVIEW_SUBJECTS = {
  CREATED: 'review.created',
} as const

export const TIME_LOG_SUBJECTS = {
  CREATED: 'time_log.created',
  STOPPED: 'time_log.stopped',
} as const

// One per talent_placement_status enum value.
export const TALENT_PLACEMENT_SUBJECTS = {
  REQUESTED: 'talent_placement.requested',
  IN_DISCUSSION: 'talent_placement.in_discussion',
  ACCEPTED: 'talent_placement.accepted',
  DECLINED: 'talent_placement.declined',
  COMPLETED: 'talent_placement.completed',
} as const

// Payment events
export const PAYMENT_SUBJECTS = {
  ESCROW_CREATED: 'payment.escrow.created',
  RELEASED: 'payment.released',
  REFUNDED: 'payment.refunded',
  PARTIAL_REFUND: 'payment.partial_refund',
  REVISION_FEE_CHARGED: 'payment.revision_fee.charged',
  TALENT_PLACEMENT_FEE_CHARGED: 'payment.talent_placement_fee.charged',
  GATEWAY_WEBHOOK_RECEIVED: 'payment.gateway.webhook_received',
  // A settled gateway payment, published from inside the webhook's own
  // transaction. The HTTP callback to project-service is attempted once and
  // never retried, and the monotonic-status guard stops Midtrans redelivery
  // from rescuing it, so this is the delivery that has to be reliable.
  SETTLED: 'payment.settled',
} as const

// Talent events
export const TALENT_SUBJECTS = {
  REGISTERED: 'talent.registered',
  VERIFIED: 'talent.verified',
  SUSPENDED: 'talent.suspended',
  UNSUSPENDED: 'talent.unsuspended',
  ASSIGNMENT_ACCEPTED: 'talent.assignment.accepted',
  ASSIGNMENT_DECLINED: 'talent.assignment.declined',
  AVAILABILITY_CHANGED: 'talent.availability_changed',
  INACTIVE_WARNING: 'talent.inactive_warning',
  ABANDON_PENALIZED: 'talent.abandon_penalized',
} as const

// Milestone events
export const MILESTONE_SUBJECTS = {
  CREATED: 'milestone.created',
  INVOICE_REQUESTED: 'milestone.invoice_requested',
  SUBMITTED: 'milestone.submitted',
  APPROVED: 'milestone.approved',
  REJECTED: 'milestone.rejected',
  REVISION_REQUESTED: 'milestone.revision_requested',
  AUTO_RELEASED: 'milestone.auto_released',
  OVERDUE: 'milestone.overdue',
  DUE_SOON: 'milestone.due_soon',
  DEPENDENCY_BLOCKED: 'milestone.dependency.blocked',
} as const

// Chat & AI events
export const CHAT_SUBJECTS = {
  MESSAGE_SENT: 'chat.message.sent',
  BYPASS_DETECTED: 'chat.bypass_detected',
} as const

export const AI_SUBJECTS = {
  BRD_GENERATED: 'ai.brd.generated',
  PRD_GENERATED: 'ai.prd.generated',
  CV_PARSED: 'ai.cv.parsed',
  BRD_EMBED_REQUESTED: 'ai.brd.embed_requested',
  PRD_EMBED_REQUESTED: 'ai.prd.embed_requested',
} as const

// System events
export const SYSTEM_SUBJECTS = {
  NOTIFICATION_SEND: 'notification.send',
  ADMIN_ACTION_PERFORMED: 'admin.action.performed',
} as const

// DLQ
export const DLQ_PREFIX = 'dlq' as const

/**
 * Every subject the platform publishes.
 *
 * appendOutboxEvent takes this type rather than string, so a subject that is
 * not declared here is a compile error at the call site. That matters because
 * nats-init-streams.sh binds streams by prefix and the notification consumer's
 * coverage test reads this file: a subject invented inline is captured by a
 * stream, delivered, and dropped by the consumer default with nothing to show
 * for it. work_package.created spent its life published as
 * project.team.worker_assigned for that reason.
 */
export type NatsSubject =
  | (typeof PROJECT_SUBJECTS)[keyof typeof PROJECT_SUBJECTS]
  | (typeof APPLICATION_SUBJECTS)[keyof typeof APPLICATION_SUBJECTS]
  | (typeof WORK_PACKAGE_SUBJECTS)[keyof typeof WORK_PACKAGE_SUBJECTS]
  | (typeof CONTRACT_SUBJECTS)[keyof typeof CONTRACT_SUBJECTS]
  | (typeof DISPUTE_SUBJECTS)[keyof typeof DISPUTE_SUBJECTS]
  | (typeof REVIEW_SUBJECTS)[keyof typeof REVIEW_SUBJECTS]
  | (typeof TIME_LOG_SUBJECTS)[keyof typeof TIME_LOG_SUBJECTS]
  | (typeof PAYMENT_SUBJECTS)[keyof typeof PAYMENT_SUBJECTS]
  | (typeof TALENT_SUBJECTS)[keyof typeof TALENT_SUBJECTS]
  | (typeof TALENT_PLACEMENT_SUBJECTS)[keyof typeof TALENT_PLACEMENT_SUBJECTS]
  | (typeof MILESTONE_SUBJECTS)[keyof typeof MILESTONE_SUBJECTS]
  | (typeof CHAT_SUBJECTS)[keyof typeof CHAT_SUBJECTS]
  | (typeof AI_SUBJECTS)[keyof typeof AI_SUBJECTS]
  | (typeof SYSTEM_SUBJECTS)[keyof typeof SYSTEM_SUBJECTS]
