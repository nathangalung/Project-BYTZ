export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const ERROR_CODES = {
  // Auth errors
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_EMAIL_ALREADY_EXISTS: 'AUTH_EMAIL_ALREADY_EXISTS',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',

  // Project errors
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_VALIDATION_INVALID_STATUS: 'PROJECT_VALIDATION_INVALID_STATUS',
  PROJECT_VALIDATION_INVALID_TRANSITION: 'PROJECT_VALIDATION_INVALID_TRANSITION',
  PROJECT_VALIDATION_MISSING_FIELDS: 'PROJECT_VALIDATION_MISSING_FIELDS',
  PROJECT_ALREADY_CANCELLED: 'PROJECT_ALREADY_CANCELLED',
  PROJECT_TEAM_FORMATION_TIMEOUT: 'PROJECT_TEAM_FORMATION_TIMEOUT',

  // Talent errors
  TALENT_NOT_FOUND: 'TALENT_NOT_FOUND',
  TALENT_NOT_VERIFIED: 'TALENT_NOT_VERIFIED',
  TALENT_SUSPENDED: 'TALENT_SUSPENDED',
  TALENT_ALREADY_ASSIGNED: 'TALENT_ALREADY_ASSIGNED',
  TALENT_CV_PARSING_FAILED: 'TALENT_CV_PARSING_FAILED',

  // Payment errors
  PAYMENT_ESCROW_INSUFFICIENT_FUNDS: 'PAYMENT_ESCROW_INSUFFICIENT_FUNDS',
  PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',
  PAYMENT_GATEWAY_ERROR: 'PAYMENT_GATEWAY_ERROR',
  PAYMENT_IDEMPOTENCY_CONFLICT: 'PAYMENT_IDEMPOTENCY_CONFLICT',
  PAYMENT_REFUND_FAILED: 'PAYMENT_REFUND_FAILED',

  // Milestone errors
  MILESTONE_NOT_FOUND: 'MILESTONE_NOT_FOUND',
  MILESTONE_INVALID_STATUS: 'MILESTONE_INVALID_STATUS',
  MILESTONE_REVISION_LIMIT: 'MILESTONE_REVISION_LIMIT',
  DOCUMENT_GENERATION_LIMIT: 'DOCUMENT_GENERATION_LIMIT',
  MILESTONE_OVERDUE: 'MILESTONE_OVERDUE',

  // Matching errors
  MATCHING_NO_TALENTS_FOUND: 'MATCHING_NO_TALENTS_FOUND',
  MATCHING_TALENT_DECLINED: 'MATCHING_TALENT_DECLINED',
  MATCHING_SLA_EXCEEDED: 'MATCHING_SLA_EXCEEDED',

  // AI errors
  AI_SERVICE_UNAVAILABLE: 'AI_SERVICE_UNAVAILABLE',
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  AI_RATE_LIMIT_EXCEEDED: 'AI_RATE_LIMIT_EXCEEDED',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',

  // Dispute errors
  DISPUTE_NOT_FOUND: 'DISPUTE_NOT_FOUND',
  DISPUTE_ALREADY_RESOLVED: 'DISPUTE_ALREADY_RESOLVED',
  DISPUTE_INVALID_STATUS: 'DISPUTE_INVALID_STATUS',

  // File errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE: 'FILE_INVALID_TYPE',
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',

  // General errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CONFLICT: 'CONFLICT',
} as const

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_UNAUTHORIZED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_EMAIL_ALREADY_EXISTS: 409,
  AUTH_INVALID_TOKEN: 401,
  AUTH_ACCOUNT_SUSPENDED: 403,

  PROJECT_NOT_FOUND: 404,
  PROJECT_VALIDATION_INVALID_STATUS: 400,
  PROJECT_VALIDATION_INVALID_TRANSITION: 400,
  PROJECT_VALIDATION_MISSING_FIELDS: 400,
  PROJECT_ALREADY_CANCELLED: 409,
  PROJECT_TEAM_FORMATION_TIMEOUT: 408,

  TALENT_NOT_FOUND: 404,
  TALENT_NOT_VERIFIED: 403,
  TALENT_SUSPENDED: 403,
  TALENT_ALREADY_ASSIGNED: 409,
  TALENT_CV_PARSING_FAILED: 500,

  PAYMENT_ESCROW_INSUFFICIENT_FUNDS: 400,
  PAYMENT_ALREADY_PROCESSED: 409,
  PAYMENT_GATEWAY_ERROR: 502,
  PAYMENT_IDEMPOTENCY_CONFLICT: 409,
  PAYMENT_REFUND_FAILED: 500,

  MILESTONE_NOT_FOUND: 404,
  MILESTONE_INVALID_STATUS: 400,
  MILESTONE_REVISION_LIMIT: 400,
  DOCUMENT_GENERATION_LIMIT: 402,
  MILESTONE_OVERDUE: 400,

  MATCHING_NO_TALENTS_FOUND: 404,
  MATCHING_TALENT_DECLINED: 400,
  MATCHING_SLA_EXCEEDED: 408,

  AI_SERVICE_UNAVAILABLE: 503,
  AI_GENERATION_FAILED: 500,
  AI_RATE_LIMIT_EXCEEDED: 429,
  AI_INVALID_RESPONSE: 502,

  DISPUTE_NOT_FOUND: 404,
  DISPUTE_ALREADY_RESOLVED: 409,
  DISPUTE_INVALID_STATUS: 400,

  FILE_TOO_LARGE: 413,
  FILE_INVALID_TYPE: 415,
  FILE_UPLOAD_FAILED: 500,

  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  RATE_LIMIT_EXCEEDED: 429,
  SERVICE_UNAVAILABLE: 503,
  CONFLICT: 409,
}

// i18n message key mapping
export const ERROR_I18N_KEYS: Record<ErrorCode, string> = {
  AUTH_INVALID_CREDENTIALS: 'errors.auth.invalid_credentials',
  AUTH_SESSION_EXPIRED: 'errors.auth.session_expired',
  AUTH_UNAUTHORIZED: 'errors.auth.unauthorized',
  AUTH_FORBIDDEN: 'errors.auth.forbidden',
  AUTH_EMAIL_ALREADY_EXISTS: 'errors.auth.email_already_exists',
  AUTH_INVALID_TOKEN: 'errors.auth.invalid_token',
  AUTH_ACCOUNT_SUSPENDED: 'errors.auth.account_suspended',

  PROJECT_NOT_FOUND: 'errors.project.not_found',
  PROJECT_VALIDATION_INVALID_STATUS: 'errors.project.invalid_status',
  PROJECT_VALIDATION_INVALID_TRANSITION: 'errors.project.invalid_transition',
  PROJECT_VALIDATION_MISSING_FIELDS: 'errors.project.missing_fields',
  PROJECT_ALREADY_CANCELLED: 'errors.project.already_cancelled',
  PROJECT_TEAM_FORMATION_TIMEOUT: 'errors.project.team_formation_timeout',

  TALENT_NOT_FOUND: 'errors.talent.not_found',
  TALENT_NOT_VERIFIED: 'errors.talent.not_verified',
  TALENT_SUSPENDED: 'errors.talent.suspended',
  TALENT_ALREADY_ASSIGNED: 'errors.talent.already_assigned',
  TALENT_CV_PARSING_FAILED: 'errors.talent.cv_parsing_failed',

  PAYMENT_ESCROW_INSUFFICIENT_FUNDS: 'errors.payment.insufficient_funds',
  PAYMENT_ALREADY_PROCESSED: 'errors.payment.already_processed',
  PAYMENT_GATEWAY_ERROR: 'errors.payment.gateway_error',
  PAYMENT_IDEMPOTENCY_CONFLICT: 'errors.payment.idempotency_conflict',
  PAYMENT_REFUND_FAILED: 'errors.payment.refund_failed',

  MILESTONE_NOT_FOUND: 'errors.milestone.not_found',
  MILESTONE_INVALID_STATUS: 'errors.milestone.invalid_status',
  MILESTONE_REVISION_LIMIT: 'errors.milestone.revision_limit',
  DOCUMENT_GENERATION_LIMIT: 'errors.document.generation_limit',
  MILESTONE_OVERDUE: 'errors.milestone.overdue',

  MATCHING_NO_TALENTS_FOUND: 'errors.matching.no_talents_found',
  MATCHING_TALENT_DECLINED: 'errors.matching.talent_declined',
  MATCHING_SLA_EXCEEDED: 'errors.matching.sla_exceeded',

  AI_SERVICE_UNAVAILABLE: 'errors.ai.service_unavailable',
  AI_GENERATION_FAILED: 'errors.ai.generation_failed',
  AI_RATE_LIMIT_EXCEEDED: 'errors.ai.rate_limit_exceeded',
  AI_INVALID_RESPONSE: 'errors.ai.invalid_response',

  DISPUTE_NOT_FOUND: 'errors.dispute.not_found',
  DISPUTE_ALREADY_RESOLVED: 'errors.dispute.already_resolved',
  DISPUTE_INVALID_STATUS: 'errors.dispute.invalid_status',

  FILE_TOO_LARGE: 'errors.file.too_large',
  FILE_INVALID_TYPE: 'errors.file.invalid_type',
  FILE_UPLOAD_FAILED: 'errors.file.upload_failed',

  VALIDATION_ERROR: 'errors.general.validation_error',
  NOT_FOUND: 'errors.general.not_found',
  INTERNAL_ERROR: 'errors.general.internal_error',
  RATE_LIMIT_EXCEEDED: 'errors.general.rate_limit_exceeded',
  SERVICE_UNAVAILABLE: 'errors.general.service_unavailable',
  CONFLICT: 'errors.general.conflict',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }

  get statusCode(): number {
    return ERROR_HTTP_STATUS[this.code]
  }

  get i18nKey(): string {
    return ERROR_I18N_KEYS[this.code]
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

export class ValidationError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, details)
    this.name = 'ValidationError'
  }
}

export class AuthError extends AppError {
  constructor(
    code: Extract<
      ErrorCode,
      | 'AUTH_INVALID_CREDENTIALS'
      | 'AUTH_SESSION_EXPIRED'
      | 'AUTH_UNAUTHORIZED'
      | 'AUTH_FORBIDDEN'
      | 'AUTH_EMAIL_ALREADY_EXISTS'
      | 'AUTH_INVALID_TOKEN'
      | 'AUTH_ACCOUNT_SUSPENDED'
    > = 'AUTH_UNAUTHORIZED',
    message?: string,
  ) {
    super(code, message)
    this.name = 'AuthError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource?: string) {
    super('NOT_FOUND', resource ? `${resource} not found` : undefined)
    this.name = 'NotFoundError'
  }
}
