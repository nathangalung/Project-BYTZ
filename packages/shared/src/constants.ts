// Matching algorithm weights
export const MATCHING_WEIGHTS = {
  SKILL_MATCH: 0.3,
  PEMERATAAN: 0.35,
  TRACK_RECORD: 0.2,
  RATING: 0.15,
} as const

// Exploration vs exploitation
export const EXPLORATION_RATE = 0.3

// Default values for new talents
export const NEW_TALENT_DEFAULTS = {
  TRACK_RECORD: 0.6,
  RATING: 0.7,
  PEMERATAAN_BONUS: 0.2,
} as const

// Margin rates by project value
export const MARGIN_RATES = {
  BELOW_10M: { min: 0.25, max: 0.3 },
  FROM_10M_TO_50M: { min: 0.2, max: 0.25 },
  FROM_50M_TO_100M: { min: 0.15, max: 0.2 },
  ABOVE_100M: { min: 0.1, max: 0.15 },
} as const

// Revision fees as percentage of milestone amount
export const REVISION_FEES = {
  MINOR: { min: 0.03, max: 0.05 },
  MODERATE: { min: 0.08, max: 0.12 },
} as const

// Free revision rounds per milestone
export const FREE_REVISION_ROUNDS = 2

// Auto-release timer (days)
export const AUTO_RELEASE_DAYS = 14

// Talent inactivity threshold (days)
export const TALENT_INACTIVITY_WARNING_DAYS = 7
export const TALENT_INACTIVITY_REASSIGN_DAYS = 10

// Matching SLA (hours)
export const MATCHING_SLA = {
  SINGLE_TALENT_HOURS: 72,
  TEAM_PROJECT_DAYS: 14,
} as const

// Team constraints
export const MAX_TEAM_SIZE = 8

// Talent placement fee
export const TALENT_PLACEMENT_FEE = {
  MIN_PERCENTAGE: 0.1,
  MAX_PERCENTAGE: 0.15,
} as const

// Rate limiting
export const RATE_LIMITS = {
  STANDARD: { requests: 100, windowMs: 60_000 },
  AI_INTENSIVE: { requests: 10, windowMs: 60_000 },
} as const

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const

// File upload limits (bytes)
export const FILE_LIMITS = {
  CV_MAX_SIZE: 5 * 1024 * 1024,
  ATTACHMENT_MAX_SIZE: 10 * 1024 * 1024,
} as const

// Health score thresholds
export const HEALTH_THRESHOLDS = {
  HEALTHY: 80,
  AT_RISK: 60,
  CRITICAL: 40,
  EMERGENCY: 0,
} as const

// Health score weights
export const HEALTH_WEIGHTS = {
  TIMELINE: 0.35,
  MILESTONE: 0.3,
  COMMUNICATION: 0.2,
  BUDGET: 0.15,
} as const

// Talent quality thresholds
export const TALENT_QUALITY = {
  WARNING_RATING: 3.5,
  WARNING_MIN_PROJECTS: 3,
  SUSPEND_RATING: 3.0,
  SUSPEND_MIN_PROJECTS: 5,
  MAX_ABANDONS_BEFORE_SUSPEND: 2,
} as const

// RAG configuration
export const RAG_CONFIG = {
  SIMILARITY_THRESHOLD: 0.5,
  TOP_K_RESULTS: 4,
  RERANK_TOP_N: 20,
  RRF_K: 60,
  EMBEDDING_DIMENSIONS: 1536,
} as const

// Milestone review and auto-release
export const MILESTONE_REVIEW_DAYS = 14

// Matching SLA (standalone)
export const MATCHING_SLA_SINGLE_HOURS = 72
export const MATCHING_SLA_TEAM_DAYS = 14

// Default document pricing (Rupiah)
export const DEFAULT_BRD_PRICE = 99_000
export const DEFAULT_PRD_PRICE = 199_000

// AI timeouts (ms)
export const AI_CHAT_TIMEOUT_MS = 30_000
export const AI_GENERATION_TIMEOUT_MS = 60_000

// API versioning
export const API_VERSION = 'v1'
