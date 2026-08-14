import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiPatch, apiUrl } from './api'

/**
 * Every admin route used to hand-roll fetch, so credentials, envelope
 * unwrapping and error extraction drifted per call site. These pin the
 * behaviour the shared client now owns.
 */

function stubFetch(response: {
  ok?: boolean
  status?: number
  body?: unknown
  invalidJson?: boolean
}) {
  const spy = vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => {
      if (response.invalidJson) throw new SyntaxError('Unexpected end of JSON input')
      return response.body
    },
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiUrl', () => {
  it('omits empty and undefined params so an empty filter is not sent', () => {
    expect(apiUrl('/api/v1/admin/users', { role: '', search: undefined, page: 1 })).toBe(
      '/api/v1/admin/users?page=1',
    )
  })

  it('returns the bare path when nothing survives', () => {
    expect(apiUrl('/api/v1/admin/users', { role: '' })).toBe('/api/v1/admin/users')
    expect(apiUrl('/api/v1/admin/dashboard')).toBe('/api/v1/admin/dashboard')
  })
})

describe('apiGet', () => {
  it('unwraps the envelope and sends the session cookie', async () => {
    const spy = stubFetch({ body: { success: true, data: { items: [], total: 7 } } })
    await expect(apiGet('/api/v1/admin/users')).resolves.toEqual({ items: [], total: 7 })
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/admin/users',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  // A rejected range answers 400 with a reason the admin needs to read.
  it('surfaces the server error message', async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: {
        success: false,
        error: { code: 'VALIDATION_RANGE_TOO_WIDE', message: 'Date range spans 365 days' },
      },
    })
    await expect(apiGet('/api/v1/admin/dashboard')).rejects.toThrow('Date range spans 365 days')
  })

  it('falls back to the status when the failure carries no JSON', async () => {
    stubFetch({ ok: false, status: 502, invalidJson: true })
    await expect(apiGet('/api/v1/admin/users')).rejects.toThrow('Request failed (502)')
  })
})

describe('apiPatch', () => {
  it('sends a JSON body', async () => {
    const spy = stubFetch({ body: { success: true, data: { id: 'u-1' } } })
    await apiPatch('/api/v1/admin/users/u-1/suspend', { adminId: 'a-1', reason: 'spam' })
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/admin/users/u-1/suspend',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ adminId: 'a-1', reason: 'spam' }),
      }),
    )
  })

  // Dispute transitions answer 204; an empty body is not a failure.
  it('treats an empty successful response as success', async () => {
    stubFetch({ status: 204, invalidJson: true })
    await expect(apiPatch('/api/v1/disputes/d-1/status', { status: 'mediation' })).resolves.toBe(
      undefined,
    )
  })
})

/** Some PATCH endpoints take no body; sending "undefined" would be a 400. */
describe('apiPatch without a body', () => {
  it('sends no body at all rather than the string undefined', async () => {
    const spy = stubFetch({ body: { success: true, data: null } })
    await apiPatch('/api/v1/admin/dlq/dlq-1/reprocess')

    expect(spy).toHaveBeenCalledWith(
      '/api/v1/admin/dlq/dlq-1/reprocess',
      expect.objectContaining({ method: 'PATCH', body: undefined }),
    )
  })
})
