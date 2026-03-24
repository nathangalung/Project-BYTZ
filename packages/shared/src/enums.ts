export const UserRole = {
  OWNER: 'owner',
  TALENT: 'talent',
} as const
export type UserRole = (typeof UserRole)[keyof typeof UserRole]

export const Locale = {
  ID: 'id',
  EN: 'en',
} as const
export type Locale = (typeof Locale)[keyof typeof Locale]

export const ProjectCategory = {
  WEB_APP: 'web_app',
  MOBILE_APP: 'mobile_app',
  UI_UX_DESIGN: 'ui_ux_design',
  DATA_AI: 'data_ai',
  OTHER_DIGITAL: 'other_digital',
} as const
export type ProjectCategory = (typeof ProjectCategory)[keyof typeof ProjectCategory]

export const ProjectStatus = {
  DRAFT: 'draft',
  SCOPING: 'scoping',
  BRD_GENERATED: 'brd_generated',
  BRD_APPROVED: 'brd_approved',
  BRD_PURCHASED: 'brd_purchased',
  PRD_GENERATED: 'prd_generated',
  PRD_APPROVED: 'prd_approved',
  PRD_PURCHASED: 'prd_purchased',
  MATCHING: 'matching',
  TEAM_FORMING: 'team_forming',
  MATCHED: 'matched',
  IN_PROGRESS: 'in_progress',
  PARTIALLY_ACTIVE: 'partially_active',
  REVIEW: 'review',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
  ON_HOLD: 'on_hold',
} as const
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus]

export const TalentTier = {
  JUNIOR: 'junior',
  MID: 'mid',
  SENIOR: 'senior',
} as const
export type TalentTier = (typeof TalentTier)[keyof typeof TalentTier]

export const AvailabilityStatus = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  UNAVAILABLE: 'unavailable',
} as const
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus]

export const VerificationStatus = {
  UNVERIFIED: 'unverified',
  CV_PARSING: 'cv_parsing',
  VERIFIED: 'verified',
  SUSPENDED: 'suspended',
} as const
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus]

export const SkillCategory = {
  FRONTEND: 'frontend',
  BACKEND: 'backend',
  MOBILE: 'mobile',
  DESIGN: 'design',
  DATA: 'data',
  DEVOPS: 'devops',
  OTHER: 'other',
} as const
export type SkillCategory = (typeof SkillCategory)[keyof typeof SkillCategory]

export const ProficiencyLevel = {
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
  EXPERT: 'expert',
} as const
export type ProficiencyLevel = (typeof ProficiencyLevel)[keyof typeof ProficiencyLevel]

export const MilestoneStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  REVISION_REQUESTED: 'revision_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus]

export const MilestoneType = {
  INDIVIDUAL: 'individual',
  INTEGRATION: 'integration',
} as const
export type MilestoneType = (typeof MilestoneType)[keyof typeof MilestoneType]

export const WorkPackageStatus = {
  UNASSIGNED: 'unassigned',
  PENDING_ACCEPTANCE: 'pending_acceptance',
  ASSIGNED: 'assigned',
  DECLINED: 'declined',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
} as const
export type WorkPackageStatus = (typeof WorkPackageStatus)[keyof typeof WorkPackageStatus]

export const AssignmentStatus = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
  REPLACED: 'replaced',
} as const
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus]

export const AcceptanceStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
} as const
export type AcceptanceStatus = (typeof AcceptanceStatus)[keyof typeof AcceptanceStatus]

export const TransactionType = {
  ESCROW_IN: 'escrow_in',
  ESCROW_RELEASE: 'escrow_release',
  BRD_PAYMENT: 'brd_payment',
  PRD_PAYMENT: 'prd_payment',
  REFUND: 'refund',
  PARTIAL_REFUND: 'partial_refund',
  REVISION_FEE: 'revision_fee',
  TALENT_PLACEMENT_FEE: 'talent_placement_fee',
} as const
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType]

export const TransactionStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus]

export const DocumentStatus = {
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  PAID: 'paid',
} as const
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus]

export const ApplicationStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus]

export const DisputeStatus = {
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  MEDIATION: 'mediation',
  RESOLVED: 'resolved',
  ESCALATED: 'escalated',
} as const
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus]

export const ResolutionType = {
  FUNDS_TO_TALENT: 'funds_to_talent',
  FUNDS_TO_OWNER: 'funds_to_owner',
  SPLIT: 'split',
} as const
export type ResolutionType = (typeof ResolutionType)[keyof typeof ResolutionType]

export const ReviewType = {
  OWNER_TO_TALENT: 'owner_to_talent',
  TALENT_TO_OWNER: 'talent_to_owner',
} as const
export type ReviewType = (typeof ReviewType)[keyof typeof ReviewType]

export const NotificationType = {
  PROJECT_MATCH: 'project_match',
  APPLICATION_UPDATE: 'application_update',
  MILESTONE_UPDATE: 'milestone_update',
  PAYMENT: 'payment',
  DISPUTE: 'dispute',
  TEAM_FORMATION: 'team_formation',
  ASSIGNMENT_OFFER: 'assignment_offer',
  SYSTEM: 'system',
} as const
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType]

export const ChatConversationType = {
  AI_SCOPING: 'ai_scoping',
  OWNER_TALENT: 'owner_talent',
  TEAM_GROUP: 'team_group',
  TALENT_TALENT: 'talent_talent',
  ADMIN_MEDIATION: 'admin_mediation',
} as const
export type ChatConversationType = (typeof ChatConversationType)[keyof typeof ChatConversationType]

export const SenderType = {
  USER: 'user',
  AI: 'ai',
  SYSTEM: 'system',
} as const
export type SenderType = (typeof SenderType)[keyof typeof SenderType]

export const TaskStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

export const DependencyType = {
  FINISH_TO_START: 'finish_to_start',
  START_TO_START: 'start_to_start',
  FINISH_TO_FINISH: 'finish_to_finish',
} as const
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType]

export const RevisionSeverity = {
  MINOR: 'minor',
  MODERATE: 'moderate',
  MAJOR: 'major',
} as const
export type RevisionSeverity = (typeof RevisionSeverity)[keyof typeof RevisionSeverity]

export const RevisionRequestStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DECLINED: 'declined',
} as const
export type RevisionRequestStatus =
  (typeof RevisionRequestStatus)[keyof typeof RevisionRequestStatus]

export const PenaltyType = {
  WARNING: 'warning',
  RATING_PENALTY: 'rating_penalty',
  SUSPENSION: 'suspension',
  BAN: 'ban',
} as const
export type PenaltyType = (typeof PenaltyType)[keyof typeof PenaltyType]

export const AppealStatus = {
  NONE: 'none',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
} as const
export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus]

export const AssessmentStage = {
  CV_PARSING: 'cv_parsing',
} as const
export type AssessmentStage = (typeof AssessmentStage)[keyof typeof AssessmentStage]

export const AssessmentStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FAILED: 'failed',
} as const
export type AssessmentStatus = (typeof AssessmentStatus)[keyof typeof AssessmentStatus]

export const AccountOwnerType = {
  PLATFORM: 'platform',
  OWNER: 'owner',
  TALENT: 'talent',
  ESCROW: 'escrow',
} as const
export type AccountOwnerType = (typeof AccountOwnerType)[keyof typeof AccountOwnerType]

export const AccountType = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  REVENUE: 'revenue',
  EXPENSE: 'expense',
} as const
export type AccountType = (typeof AccountType)[keyof typeof AccountType]

export const LedgerEntryType = {
  DEBIT: 'debit',
  CREDIT: 'credit',
} as const
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType]

export const ContractType = {
  STANDARD_NDA: 'standard_nda',
  IP_TRANSFER: 'ip_transfer',
} as const
export type ContractType = (typeof ContractType)[keyof typeof ContractType]

export const TalentPlacementStatus = {
  REQUESTED: 'requested',
  IN_DISCUSSION: 'in_discussion',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  COMPLETED: 'completed',
} as const
export type TalentPlacementStatus =
  (typeof TalentPlacementStatus)[keyof typeof TalentPlacementStatus]

export const ActivityType = {
  MESSAGE_SENT: 'message_sent',
  MILESTONE_SUBMITTED: 'milestone_submitted',
  MILESTONE_APPROVED: 'milestone_approved',
  MILESTONE_REJECTED: 'milestone_rejected',
  REVISION_REQUESTED: 'revision_requested',
  PAYMENT_MADE: 'payment_made',
  PAYMENT_RELEASED: 'payment_released',
  FILE_UPLOADED: 'file_uploaded',
  STATUS_CHANGED: 'status_changed',
  TALENT_ASSIGNED: 'talent_assigned',
  TALENT_REPLACED: 'talent_replaced',
  TALENT_DECLINED: 'talent_declined',
  TEAM_FORMED: 'team_formed',
  REVIEW_POSTED: 'review_posted',
  DISPUTE_OPENED: 'dispute_opened',
  DISPUTE_RESOLVED: 'dispute_resolved',
  PROJECT_ON_HOLD: 'project_on_hold',
  PROJECT_RESUMED: 'project_resumed',
} as const
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType]

export const AiInteractionType = {
  CHATBOT: 'chatbot',
  BRD_GENERATION: 'brd_generation',
  PRD_GENERATION: 'prd_generation',
  CV_PARSING: 'cv_parsing',
  MATCHING: 'matching',
  EMBEDDING: 'embedding',
} as const
export type AiInteractionType = (typeof AiInteractionType)[keyof typeof AiInteractionType]

export const ChatParticipantRole = {
  MEMBER: 'member',
  MODERATOR: 'moderator',
} as const
export type ChatParticipantRole = (typeof ChatParticipantRole)[keyof typeof ChatParticipantRole]

export const TransactionEventType = {
  ESCROW_CREATED: 'escrow_created',
  MILESTONE_SUBMITTED: 'milestone_submitted',
  MILESTONE_APPROVED: 'milestone_approved',
  FUNDS_RELEASED: 'funds_released',
  REFUND_INITIATED: 'refund_initiated',
  DISPUTE_OPENED: 'dispute_opened',
  DISPUTE_RESOLVED: 'dispute_resolved',
} as const
export type TransactionEventType = (typeof TransactionEventType)[keyof typeof TransactionEventType]
