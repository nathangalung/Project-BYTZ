import { createLogger } from '@kerjacus/logger'
import { AppError } from '@kerjacus/shared'
import type { Context } from 'hono'

const logger = createLogger('auth-service')

export async function errorHandler(err: Error, c: Context) {
  const requestId = c.req.header('X-Request-ID') ?? 'unknown'

  if (err instanceof AppError) {
    logger.warn(
      { code: err.code, message: err.message, requestId, details: err.details },
      'Application error',
    )
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.statusCode as 400,
    )
  }

  logger.error({ err, requestId }, 'Unhandled error')

  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    },
    500,
  )
}
