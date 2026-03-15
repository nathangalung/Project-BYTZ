import type { NATSEvent } from '@bytz/shared'

// Project event payloads
export type ProjectStatusChangedPayload = {
  projectId: string
  fromStatus: string | null
  toStatus: string
  changedBy: string
  reason?: string
}

export type ProjectTeamWorkerAssignedPayload = {
  projectId: string
  workerId: string
  workPackageId: string
  roleLabel: string
}

// Payment event payloads
export type PaymentEscrowCreatedPayload = {
  projectId: string
  transactionId: string
  amount: number
  clientId: string
}

export type PaymentReleasedPayload = {
  projectId: string
  milestoneId: string
  workerId: string
  amount: number
  transactionId: string
}

// Worker event payloads
export type WorkerRegisteredPayload = {
  userId: string
  workerId: string
  cvFileUrl: string | null
}

export type WorkerVerifiedPayload = {
  userId: string
  workerId: string
}

// Milestone event payloads
export type MilestoneSubmittedPayload = {
  milestoneId: string
  projectId: string
  workerId: string
}

export type MilestoneApprovedPayload = {
  milestoneId: string
  projectId: string
  workerId: string
  amount: number
}

// AI event payloads
export type AiBrdGeneratedPayload = {
  projectId: string
  brdDocumentId: string
}

export type AiCvParsedPayload = {
  workerId: string
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

// Event type aliases
export type ProjectStatusChangedEvent = NATSEvent<ProjectStatusChangedPayload>
export type PaymentReleasedEvent = NATSEvent<PaymentReleasedPayload>
export type WorkerRegisteredEvent = NATSEvent<WorkerRegisteredPayload>
export type MilestoneSubmittedEvent = NATSEvent<MilestoneSubmittedPayload>
export type NotificationSendEvent = NATSEvent<NotificationSendPayload>
