import { AppError, ERROR_HTTP_STATUS } from '@bytz/shared'
import type { Context } from 'hono'

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    const status = ERROR_HTTP_STATUS[err.code] ?? 500
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      status as 400,
    )
  }

  console.error('Unhandled error:', err)

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
