import { describe, expect, it } from 'vitest'
import {
  AppError,
  AuthError,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_I18N_KEYS,
  NotFoundError,
  ValidationError,
} from './errors'

describe('AppError', () => {
  it('creates with code and message', () => {
    const err = new AppError('NOT_FOUND', 'Resource missing')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Resource missing')
    expect(err.statusCode).toBe(404)
  })

  it('defaults message to code', () => {
    const err = new AppError('INTERNAL_ERROR')
    expect(err.message).toBe('INTERNAL_ERROR')
  })

  it('serializes to JSON', () => {
    const err = new AppError('VALIDATION_ERROR', 'bad input', {
      field: 'name',
    })
    const json = err.toJSON()
    expect(json.code).toBe('VALIDATION_ERROR')
    expect(json.message).toBe('bad input')
    expect(json.details).toEqual({ field: 'name' })
  })

  it('has i18n key', () => {
    const err = new AppError('AUTH_UNAUTHORIZED')
    expect(err.i18nKey).toBe('errors.auth.unauthorized')
  })

  it('has correct statusCode', () => {
    expect(new AppError('AUTH_FORBIDDEN').statusCode).toBe(403)
    expect(new AppError('RATE_LIMIT_EXCEEDED').statusCode).toBe(429)
    expect(new AppError('SERVICE_UNAVAILABLE').statusCode).toBe(503)
  })

  it('sets name to AppError', () => {
    const err = new AppError('CONFLICT')
    expect(err.name).toBe('AppError')
  })

  it('is instanceof Error', () => {
    const err = new AppError('INTERNAL_ERROR')
    expect(err).toBeInstanceOf(Error)
  })

  it('stores details', () => {
    const err = new AppError('VALIDATION_ERROR', 'bad', { a: 1, b: 'c' })
    expect(err.details).toEqual({ a: 1, b: 'c' })
  })

  it('details undefined when omitted', () => {
    const err = new AppError('NOT_FOUND')
    expect(err.details).toBeUndefined()
  })
})

describe('ValidationError', () => {
  it('extends AppError with 400', () => {
    const err = new ValidationError('bad data')
    expect(err.statusCode).toBe(400)
    expect(err.name).toBe('ValidationError')
    expect(err.code).toBe('VALIDATION_ERROR')
  })

  it('is instanceof AppError', () => {
    const err = new ValidationError()
    expect(err).toBeInstanceOf(AppError)
  })

  it('accepts details', () => {
    const err = new ValidationError('fail', { field: 'email' })
    expect(err.details).toEqual({ field: 'email' })
  })
})

describe('AuthError', () => {
  it('defaults to unauthorized', () => {
    const err = new AuthError()
    expect(err.code).toBe('AUTH_UNAUTHORIZED')
    expect(err.statusCode).toBe(401)
  })

  it('accepts specific code', () => {
    const err = new AuthError('AUTH_FORBIDDEN')
    expect(err.statusCode).toBe(403)
  })

  it('sets name to AuthError', () => {
    const err = new AuthError()
    expect(err.name).toBe('AuthError')
  })

  it('accepts custom message', () => {
    const err = new AuthError('AUTH_SESSION_EXPIRED', 'Token expired')
    expect(err.message).toBe('Token expired')
    expect(err.statusCode).toBe(401)
  })

  it('handles all auth codes', () => {
    expect(new AuthError('AUTH_INVALID_CREDENTIALS').statusCode).toBe(401)
    expect(new AuthError('AUTH_EMAIL_ALREADY_EXISTS').statusCode).toBe(409)
    expect(new AuthError('AUTH_INVALID_TOKEN').statusCode).toBe(401)
    expect(new AuthError('AUTH_ACCOUNT_SUSPENDED').statusCode).toBe(403)
  })
})

describe('NotFoundError', () => {
  it('creates with resource name', () => {
    const err = new NotFoundError('Project')
    expect(err.message).toBe('Project not found')
    expect(err.statusCode).toBe(404)
  })

  it('sets name to NotFoundError', () => {
    const err = new NotFoundError('User')
    expect(err.name).toBe('NotFoundError')
  })

  it('defaults to NOT_FOUND code', () => {
    const err = new NotFoundError()
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('NOT_FOUND')
  })
})

describe('ERROR_CODES', () => {
  it('maps all codes to HTTP status', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_HTTP_STATUS[code]).toBeDefined()
      expect(typeof ERROR_HTTP_STATUS[code]).toBe('number')
    }
  })

  it('maps all codes to i18n keys', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_I18N_KEYS[code]).toBeDefined()
      expect(ERROR_I18N_KEYS[code]).toMatch(/^errors\./)
    }
  })

  it('has auth error codes', () => {
    expect(ERROR_CODES.AUTH_UNAUTHORIZED).toBeDefined()
    expect(ERROR_CODES.AUTH_FORBIDDEN).toBeDefined()
  })

  it('has project error codes', () => {
    expect(ERROR_CODES.PROJECT_NOT_FOUND).toBeDefined()
    expect(ERROR_CODES.PROJECT_VALIDATION_INVALID_STATUS).toBeDefined()
  })

  it('has payment error codes', () => {
    expect(ERROR_CODES.PAYMENT_ESCROW_INSUFFICIENT_FUNDS).toBeDefined()
    expect(ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT).toBeDefined()
  })

  it('has general error codes', () => {
    expect(ERROR_CODES.VALIDATION_ERROR).toBeDefined()
    expect(ERROR_CODES.INTERNAL_ERROR).toBeDefined()
    expect(ERROR_CODES.NOT_FOUND).toBeDefined()
  })
})

describe('ERROR_HTTP_STATUS', () => {
  it('returns correct HTTP status codes', () => {
    expect(ERROR_HTTP_STATUS.AUTH_UNAUTHORIZED).toBe(401)
    expect(ERROR_HTTP_STATUS.AUTH_FORBIDDEN).toBe(403)
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404)
    expect(ERROR_HTTP_STATUS.CONFLICT).toBe(409)
    expect(ERROR_HTTP_STATUS.RATE_LIMIT_EXCEEDED).toBe(429)
    expect(ERROR_HTTP_STATUS.INTERNAL_ERROR).toBe(500)
    expect(ERROR_HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503)
  })

  it('uses 400 for validation errors', () => {
    expect(ERROR_HTTP_STATUS.VALIDATION_ERROR).toBe(400)
    expect(ERROR_HTTP_STATUS.MILESTONE_INVALID_STATUS).toBe(400)
    expect(ERROR_HTTP_STATUS.PROJECT_VALIDATION_INVALID_STATUS).toBe(400)
  })

  it('uses 502 for gateway errors', () => {
    expect(ERROR_HTTP_STATUS.PAYMENT_GATEWAY_ERROR).toBe(502)
    expect(ERROR_HTTP_STATUS.AI_INVALID_RESPONSE).toBe(502)
  })
})
