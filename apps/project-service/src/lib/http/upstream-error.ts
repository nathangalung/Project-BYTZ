import { AppError, type ErrorCode } from '@kerjacus/shared'

export type UpstreamService = 'payment-service' | 'ai-service' | 'auth-service'

/** Which catalog code a given downstream maps to. */
const SERVICE_ERROR_CODE: Record<UpstreamService, ErrorCode> = {
  'ai-service': 'AI_SERVICE_UNAVAILABLE',
  'payment-service': 'SERVICE_UNAVAILABLE',
  'auth-service': 'SERVICE_UNAVAILABLE',
}

/**
 * A downstream service call failed.
 *
 * `status` is the upstream HTTP status, or null for a transport failure,
 * timeout or open circuit. `detail` is the upstream error body and is for
 * logs only: `toAppError` is what reaches the browser, because exposing
 * external service detail to users is forbidden and routes/projects.ts was
 * slicing 200 characters of the AI service response into a user-visible
 * message.
 */
export class UpstreamError extends Error {
  constructor(
    readonly service: UpstreamService,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(`${service} call failed (${status ?? 'transport'})${detail ? `: ${detail}` : ''}`)
    this.name = 'UpstreamError'
  }

  /** 4xx is a bug in our request; retrying it only holds capacity. */
  get retryable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500
  }

  /** Safe to surface. Message text is resolved from the i18n catalog downstream. */
  toAppError(): AppError {
    return new AppError(SERVICE_ERROR_CODE[this.service])
  }
}
