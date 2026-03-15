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
  TEAM_WORKER_ASSIGNED: 'project.team.worker_assigned',
  TEAM_WORKER_REPLACED: 'project.team.worker_replaced',
  TEAM_COMPLETE: 'project.team.complete',
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
} as const

// Worker events
export const WORKER_SUBJECTS = {
  REGISTERED: 'worker.registered',
  VERIFIED: 'worker.verified',
  SUSPENDED: 'worker.suspended',
  UNSUSPENDED: 'worker.unsuspended',
  ASSIGNMENT_ACCEPTED: 'worker.assignment.accepted',
  ASSIGNMENT_DECLINED: 'worker.assignment.declined',
} as const

// Milestone events
export const MILESTONE_SUBJECTS = {
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
  MATCHING_COMPLETED: 'ai.matching.completed',
} as const

// System events
export const SYSTEM_SUBJECTS = {
  NOTIFICATION_SEND: 'notification.send',
  ADMIN_ACTION_PERFORMED: 'admin.action.performed',
} as const

// DLQ
export const DLQ_PREFIX = 'dlq' as const
