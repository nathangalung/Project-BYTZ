import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendOtp } from './sms'

describe('sendOtp (Zenziva WhatsApp)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
  })

  it('sends via Zenziva WA when keys configured', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '1', text: 'Success', messageId: '594512' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await sendOtp('+6281234567890', '123456')
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('594512')
    expect(mockFetch.mock.calls[0][0]).toContain('zenziva.net/wareguler/api/sendWA')
  })

  it('strips + prefix from phone', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    const mockFetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: '1' }) })
    vi.stubGlobal('fetch', mockFetch)

    await sendOtp('+6281999888777', '654321')
    const body = mockFetch.mock.calls[0][1].body as string
    expect(body).toContain('to=6281999888777')
  })

  it('returns Zenziva error on status 0', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: '0', text: 'Invalid number' }),
      }),
    )
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const _result = await sendOtp('+6281234567890', '123456')
    // In non-production, falls back to dev console after Zenziva fails
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Zenziva'),
      expect.stringContaining('Invalid'),
    )
    spy.mockRestore()
  })

  it('handles network error', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const _result = await sendOtp('+6281234567890', '123456')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Zenziva'), 'Timeout')
    spy.mockRestore()
  })

  it('falls back to console in dev without keys', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await sendOtp('+6281234567890', '123456')
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('dev-console')
    spy.mockRestore()
  })
})
