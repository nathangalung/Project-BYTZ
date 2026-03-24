import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from './error-handler'

type ErrorBody = { success: boolean; error: { code: string; message: string; details?: unknown } }

function createApp() {
  const app = new Hono()
  app.onError(errorHandler)
  return app
}

describe('error handler middleware', () => {
  it('handles AppError with correct status code', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorBody
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('PROJECT_NOT_FOUND')
    expect(body.error.message).toBe('Project not found')
  })

  it('uses toJSON() for AppError response', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('VALIDATION_ERROR', 'Bad data', { field: 'title' })
    })

    const res = await app.request('/test')
    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Bad data')
    expect(body.error.details).toEqual({ field: 'title' })
  })

  it('handles MILESTONE_NOT_FOUND with 404', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('MILESTONE_NOT_FOUND', 'Milestone not found')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(404)
  })

  it('handles PROJECT_VALIDATION_INVALID_TRANSITION with 400', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('PROJECT_VALIDATION_INVALID_TRANSITION', 'Invalid transition', {
        currentStatus: 'draft',
        targetStatus: 'completed',
      })
    })

    const res = await app.request('/test')
    expect(res.status).toBe(400)
  })

  it('handles AUTH_UNAUTHORIZED with 401', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('AUTH_UNAUTHORIZED', 'Not authorized')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(401)
  })

  it('handles CONFLICT with 409', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('CONFLICT', 'Already exists')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(409)
  })

  it('handles unknown errors as 500 INTERNAL_ERROR', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new Error('something unexpected')
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.request('/test')
    expect(res.status).toBe(500)

    const body = (await res.json()) as ErrorBody
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('An unexpected error occurred')

    consoleSpy.mockRestore()
  })

  it('does not leak internal error details to client', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new Error('secret database password leaked')
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.request('/test')
    const body = (await res.json()) as ErrorBody
    expect(body.error.message).not.toContain('secret')
    expect(body.error.message).toBe('An unexpected error occurred')

    consoleSpy.mockRestore()
  })

  it('uses logger from context when available', async () => {
    const mockLogger = { error: vi.fn() }
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('logger' as never, mockLogger as never)
      await next()
    })
    app.onError(errorHandler)
    app.get('/test', () => {
      throw new Error('logged error')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(500)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Unhandled error',
    )
  })

  it('falls back to console.error when no logger in context', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = createApp()
    app.get('/test', () => {
      throw new Error('no logger context')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('handles TypeError gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = createApp()
    app.get('/test', () => {
      const obj = null as unknown as { method: () => void }
      obj.method()
      return new Response('unreachable')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(500)

    consoleSpy.mockRestore()
  })
})
