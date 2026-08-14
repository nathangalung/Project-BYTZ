import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendOtp } from './sms'

describe('sendOtp (Zenziva WhatsApp)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
  })

  it('sends via Zenziva WA when keys configured', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '1', text: 'Success', messageId: '594512' }),
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const result = await sendOtp('+6281234567890', '123456')
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('594512')
    expect(mockFetch.mock.calls[0][0]).toContain('zenziva.net/wareguler/api/sendWA')
  })

  it('strips + prefix from phone', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    const mockFetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: '1' }) })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await sendOtp('+6281999888777', '654321')
    const body = mockFetch.mock.calls[0][1].body as string
    expect(body).toContain('to=6281999888777')
  })

  /** Numbers stored without the prefix go out unchanged, not one digit short. */
  it('leaves a phone that has no + prefix alone', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    const mockFetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: '1' }) })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await sendOtp('6281999888777', '654321')

    const body = mockFetch.mock.calls[0][1].body as string
    expect(body).toContain('to=6281999888777')
  })

  it('returns Zenziva error on status 0', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '0', text: 'Invalid number' }),
    }) as unknown as typeof fetch
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
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Timeout')) as unknown as typeof fetch
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

  /** Zenziva echoes the destination when it sends no id of its own. */
  it('uses the destination as the message id when Zenziva omits one', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '1', to: '6281234567890' }),
    }) as unknown as typeof fetch

    const result = await sendOtp('+6281234567890', '123456')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('6281234567890')
  })

  /**
   * Half-configured is not configured. A user key with no pass key would post
   * an unauthenticated request on every OTP; the call has to be refused before
   * it is made.
   */
  it('does not call Zenziva when only half the credentials are set', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendOtp('+6281234567890', '123456')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Zenziva'),
      'ZENZIVA keys not configured',
    )
    spy.mockRestore()
  })

  it('reports a generic failure when Zenziva sends no reason', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '0' }),
    }) as unknown as typeof fetch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendOtp('+6281234567890', '123456')

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Zenziva'),
      'Zenziva WhatsApp send failed',
    )
    spy.mockRestore()
  })

  /** fetch can reject with something that is not an Error. */
  it('survives a non-Error rejection', async () => {
    process.env.ZENZIVA_USER_KEY = 'k'
    process.env.ZENZIVA_API_KEY = 'p'
    globalThis.fetch = vi.fn().mockRejectedValue('socket hang up') as unknown as typeof fetch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await sendOtp('+6281234567890', '123456')

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Zenziva'), 'Network error')
    // Dev still falls through to the console, so delivery is not lost here.
    expect(result.success).toBe(true)
    spy.mockRestore()
  })

  describe('in production', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    /**
     * The console fallback is a development affordance. In production an
     * unconfigured gateway has to fail loudly, not report a code as sent that
     * only ever reached a log line.
     */
    it('refuses rather than logging the code when no gateway is configured', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await sendOtp('+6281234567890', '123456')

      expect(result.success).toBe(false)
      expect(result.error).toContain('ZENZIVA_USER_KEY')
      expect(log).not.toHaveBeenCalled()
      log.mockRestore()
    })

    it('returns the gateway result when the send succeeds', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      process.env.ZENZIVA_USER_KEY = 'k'
      process.env.ZENZIVA_API_KEY = 'p'
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: '1', messageId: '594512' }),
      }) as unknown as typeof fetch

      const result = await sendOtp('+6281234567890', '123456')

      expect(result).toEqual({ success: true, messageId: '594512' })
    })
  })
})
