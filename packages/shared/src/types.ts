import type {
  AvailabilityStatus,
  DocumentStatus,
  Locale,
  MilestoneStatus,
  MilestoneType,
  NotificationType,
  ProjectCategory,
  ProjectStatus,
  SkillCategory,
  TalentTier,
  TransactionStatus,
  TransactionType,
  UserRole,
  VerificationStatus,
  WorkPackageStatus,
} from './enums'

// API response wrapper
export type ApiResponse<T = unknown> = {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// Paginated response
export type PaginatedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// User
export type User = {
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole
  avatarUrl: string | null
  isVerified: boolean
  locale: Locale
  createdAt: string
  updatedAt: string
}

// Talent profile
export type TalentProfile = {
  id: string
  userId: string
  bio: string | null
  yearsOfExperience: number
  tier: TalentTier
  educationUniversity: string | null
  educationMajor: string | null
  educationYear: number | null
  cvFileUrl: string | null
  cvParsedData: Record<string, unknown> | null
  portfolioLinks: Array<{ platform: string; url: string }> | null
  hourlyRateExpectation: number | null
  availabilityStatus: AvailabilityStatus
  verificationStatus: VerificationStatus
  domainExpertise: string[] | null
  totalProjectsCompleted: number
  totalProjectsActive: number
  averageRating: number | null
  pemerataanPenalty: number
  createdAt: string
  updatedAt: string
}

// Project
export type Project = {
  id: string
  ownerId: string
  title: string
  description: string
  category: ProjectCategory
  status: ProjectStatus
  budgetMin: number
  budgetMax: number
  estimatedTimelineDays: number
  teamSize: number
  finalPrice: number | null
  platformFee: number | null
  talentPayout: number | null
  preferences: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

// Milestone
export type Milestone = {
  id: string
  projectId: string
  workPackageId: string | null
  assignedTalentId: string | null
  title: string
  description: string
  milestoneType: MilestoneType
  orderIndex: number
  amount: number
  status: MilestoneStatus
  revisionCount: number
  dueDate: string
  submittedAt: string | null
  completedAt: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

// Skill
export type Skill = {
  id: string
  name: string
  category: SkillCategory
  aliases: string[] | null
}

// Notification
export type Notification = {
  id: string
  userId: string
  type: NotificationType
  title: string
  message: string
  link: string | null
  isRead: boolean
  createdAt: string
}

// WorkPackage
export type WorkPackage = {
  id: string
  projectId: string
  title: string
  description: string
  orderIndex: number
  requiredSkills: string[]
  estimatedHours: number
  amount: number
  talentPayout: number
  status: WorkPackageStatus
  createdAt: string
  updatedAt: string
}

// BRD/PRD Document
export type BrdDocument = {
  id: string
  projectId: string
  content: Record<string, unknown>
  version: number
  status: DocumentStatus
  price: number
  createdAt: string
  updatedAt: string
}

export type PrdDocument = {
  id: string
  projectId: string
  content: Record<string, unknown>
  version: number
  status: DocumentStatus
  price: number
  createdAt: string
  updatedAt: string
}

// Transaction
export type Transaction = {
  id: string
  projectId: string
  workPackageId: string | null
  milestoneId: string | null
  talentId: string | null
  type: TransactionType
  amount: number
  status: TransactionStatus
  paymentMethod: string | null
  paymentGatewayRef: string | null
  idempotencyKey: string
  createdAt: string
  updatedAt: string
}

// NATS event envelope
export type NATSEvent<T = unknown> = {
  id: string
  type: string
  source: string
  timestamp: string
  data: T
}
