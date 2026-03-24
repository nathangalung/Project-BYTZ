import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('sendOtp', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses Zenziva when ZENZIVA keys are set and succeeds', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    delete process.env.FONNTE_API_KEY

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '1', to: '+6281234567890' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '123456')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('+6281234567890')
    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain('zenziva.net')
  })

  it('falls back to Fonnte when Zenziva not configured', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    process.env.FONNTE_API_KEY = 'test-fonnte-key'

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: true, id: 'msg-001' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '654321')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-001')
    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain('fonnte.com')
  })

  it('falls back to Fonnte when Zenziva fails', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    process.env.FONNTE_API_KEY = 'test-fonnte-key'

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ status: '0', text: 'Zenziva error' }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ status: true, id: 'fonnte-msg' }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '111222')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('fonnte-msg')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    consoleSpy.mockRestore()
  })

  it('falls to dev console when no providers configured (non-production)', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    delete process.env.FONNTE_API_KEY
    process.env.NODE_ENV = 'development'

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '999888')

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('dev-console')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DEV OTP]'))

    consoleSpy.mockRestore()
  })

  it('returns error in production without any provider', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    delete process.env.FONNTE_API_KEY
    process.env.NODE_ENV = 'production'

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '333444')

    expect(result.success).toBe(false)
    expect(result.error).toBe('No SMS provider configured')
  })

  it('handles Zenziva network error gracefully', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    delete process.env.FONNTE_API_KEY
    process.env.NODE_ENV = 'development'

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'))
    vi.stubGlobal('fetch', mockFetch)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '555666')

    // Should fall through to dev console
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('dev-console')

    consoleSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('handles Fonnte network error gracefully', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    process.env.FONNTE_API_KEY = 'test-fonnte-key'
    process.env.NODE_ENV = 'development'

    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
    vi.stubGlobal('fetch', mockFetch)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '777888')

    // Should fall through to dev console
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('dev-console')

    consoleSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('includes correct OTP message format', async () => {
    process.env.ZENZIVA_USER_KEY = 'test-user-key'
    process.env.ZENZIVA_API_KEY = 'test-api-key'
    delete process.env.FONNTE_API_KEY

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: '1', to: '+6281234567890' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendOtp } = await import('./sms')
    await sendOtp('+6281234567890', '123456')

    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain('message=')
    expect(fetchUrl).toContain('123456')
    expect(fetchUrl).toContain('KerjaCUS')
  })

  it('sends to correct phone number via Fonnte', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    process.env.FONNTE_API_KEY = 'test-fonnte-key'

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: true, id: 'msg-002' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendOtp } = await import('./sms')
    await sendOtp('+6289876543210', '654321')

    // Verify Fonnte was called with correct authorization header
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.fonnte.com/send',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'test-fonnte-key' },
      }),
    )
  })

  it('handles Fonnte returning failure status', async () => {
    delete process.env.ZENZIVA_USER_KEY
    delete process.env.ZENZIVA_API_KEY
    process.env.FONNTE_API_KEY = 'test-fonnte-key'
    process.env.NODE_ENV = 'development'

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: false, reason: 'Invalid number' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendOtp } = await import('./sms')
    const result = await sendOtp('+6281234567890', '111222')

    // Falls through to dev console
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('dev-console')

    consoleSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })
})
