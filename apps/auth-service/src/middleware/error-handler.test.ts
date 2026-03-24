import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

// Mock logger to prevent pino initialization side effects
vi.mock('@kerjacus/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

import { errorHandler } from './error-handler'

type ErrorBody = { success: boolean; error: { code: string; message: string; details?: unknown } }

function createApp() {
  const app = new Hono()
  app.onError(errorHandler)
  return app
}

describe('error handler middleware', () => {
  it('handles AppError with correct status code and structure', async () => {
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

  it('handles AppError with details', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('VALIDATION_ERROR', 'Invalid input', { field: 'email' })
    })

    const res = await app.request('/test')
    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toEqual({ field: 'email' })
  })

  it('handles AUTH_UNAUTHORIZED with 401', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('AUTH_UNAUTHORIZED', 'Not authorized')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED')
  })

  it('handles AUTH_FORBIDDEN with 403', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('AUTH_FORBIDDEN', 'Forbidden')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(403)
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

    const res = await app.request('/test')
    expect(res.status).toBe(500)

    const body = (await res.json()) as ErrorBody
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('An unexpected error occurred')
  })

  it('does not leak internal error details to client', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new Error('database password is xyz123')
    })

    const res = await app.request('/test')
    const body = (await res.json()) as ErrorBody

    expect(body.error.message).not.toContain('xyz123')
    expect(body.error.message).toBe('An unexpected error occurred')
  })

  it('handles TypeError as 500', async () => {
    const app = createApp()
    app.get('/test', () => {
      const obj: Record<string, unknown> = {}
      ;(obj.nonexistent as { call: () => void }).call()
      return new Response('unreachable')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(500)
  })

  it('handles NOT_FOUND with 404', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('NOT_FOUND', 'Resource missing')
    })

    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'req-abc-123' },
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('handles RATE_LIMIT_EXCEEDED with 429', async () => {
    const app = createApp()
    app.get('/test', () => {
      throw new AppError('RATE_LIMIT_EXCEEDED', 'Too many requests')
    })

    const res = await app.request('/test')
    expect(res.status).toBe(429)
  })
})
