import type { NATSEvent } from '@kerjacus/shared'

// Project event payloads
export type ProjectStatusChangedPayload = {
  projectId: string
  fromStatus: string | null
  toStatus: string
  changedBy: string
  reason?: string
}

export type ProjectTeamTalentAssignedPayload = {
  projectId: string
  talentId: string
  workPackageId: string
  roleLabel: string
}

// Payment event payloads
export type PaymentEscrowCreatedPayload = {
  projectId: string
  transactionId: string
  amount: number
  ownerId: string
}

export type PaymentReleasedPayload = {
  projectId: string
  milestoneId: string
  talentId: string
  amount: number
  transactionId: string
}

// Talent event payloads
export type TalentRegisteredPayload = {
  userId: string
  talentId: string
  cvFileUrl: string | null
}

export type TalentVerifiedPayload = {
  userId: string
  talentId: string
}

// Milestone event payloads
export type MilestoneSubmittedPayload = {
  milestoneId: string
  projectId: string
  talentId: string
}

export type MilestoneApprovedPayload = {
  milestoneId: string
  projectId: string
  talentId: string
  amount: number
}

// AI event payloads
export type AiBrdGeneratedPayload = {
  projectId: string
  brdDocumentId: string
}

export type AiCvParsedPayload = {
  talentId: string
  status: 'success' | 'failed'
}

// Notification event payload
export type NotificationSendPayload = {
  userId: string
  type: string
  title: string
  message: string
  link?: string
  channels: Array<'in_app' | 'email'>
}

// Project created payload
export type ProjectCreatedPayload = {
  projectId: string
  ownerId: string
  title: string
  category: string
}

// Dispute status changed payload
export type DisputeStatusChangedPayload = {
  disputeId: string
  projectId: string
  fromStatus: string
  toStatus: string
  changedBy: string
}

// Revision request created payload
export type RevisionRequestCreatedPayload = {
  milestoneId: string
  projectId: string
  requestedBy: string
  severity: string
  isPaid: boolean
}

// Event type aliases
export type ProjectCreatedEvent = NATSEvent<ProjectCreatedPayload>
export type ProjectStatusChangedEvent = NATSEvent<ProjectStatusChangedPayload>
export type PaymentReleasedEvent = NATSEvent<PaymentReleasedPayload>
export type TalentRegisteredEvent = NATSEvent<TalentRegisteredPayload>
export type MilestoneSubmittedEvent = NATSEvent<MilestoneSubmittedPayload>
export type NotificationSendEvent = NATSEvent<NotificationSendPayload>
export type DisputeStatusChangedEvent = NATSEvent<DisputeStatusChangedPayload>
export type RevisionRequestCreatedEvent = NATSEvent<RevisionRequestCreatedPayload>
