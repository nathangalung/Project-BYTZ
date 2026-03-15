import { AppError } from '@bytz/shared'
import type { Context } from 'hono'

export async function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json(
      {
        success: false,
        error: err.toJSON(),
      },
      err.statusCode as 400,
    )
  }

  const logger = c.get('logger')
  if (logger) {
    logger.error({ err }, 'Unhandled error')
  } else {
    console.error('Unhandled error:', err)
  }

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
