import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * email.ts reads RESEND_API_KEY into a module constant at import time, so the
 * configured and unconfigured branches are two different module instances.
 * Load it per case rather than mutating env and hoping.
 */
async function loadEmail(env: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }
  return import('./email')
}

function fetchReturning(response: Partial<Response>) {
  const mock = vi.fn(async () => response as Response)
  vi.stubGlobal('fetch', mock)
  return mock
}

const PARAMS = { to: 'user@test.com', subject: 'Halo', html: '<p>Halo</p>' }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sendEmail', () => {
  /**
   * Without a key there is nothing to authenticate with, so the request must
   * not go out at all. Posting it anyway would leak the recipient and the body
   * to Resend on every call and come back 401.
   */
  it('does not call Resend when no API key is configured', async () => {
    const { sendEmail } = await loadEmail({ RESEND_API_KEY: '' })
    const mock = fetchReturning({ ok: true })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(sendEmail(PARAMS)).resolves.toBeUndefined()

    expect(mock).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })

  it('posts to Resend with the key and the configured sender', async () => {
    const { sendEmail } = await loadEmail({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM: 'KerjaCUS <halo@kerjacus.id>',
    })
    const mock = fetchReturning({ ok: true })

    await sendEmail(PARAMS)

    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key')
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'KerjaCUS <halo@kerjacus.id>',
      ...PARAMS,
    })
  })

  it('falls back to the noreply sender when none is configured', async () => {
    const { sendEmail } = await loadEmail({ RESEND_API_KEY: 're_test_key', RESEND_FROM: '' })
    const mock = fetchReturning({ ok: true })

    await sendEmail(PARAMS)

    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).from).toBe('KerjaCUS <noreply@kerjacus.id>')
  })

  /**
   * A rejected send has to throw. Better Auth awaits this inside sign-up, and
   * swallowing the failure would leave an account whose verification mail was
   * never delivered and whose owner is never told.
   */
  it('throws with the status and body when Resend refuses', async () => {
    const { sendEmail } = await loadEmail({ RESEND_API_KEY: 're_test_key' })
    fetchReturning({ ok: false, status: 422, text: async () => 'domain not verified' })

    await expect(sendEmail(PARAMS)).rejects.toThrow('Resend send failed: 422 domain not verified')
  })

  it('still throws when the failure body cannot be read', async () => {
    const { sendEmail } = await loadEmail({ RESEND_API_KEY: 're_test_key' })
    fetchReturning({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream already consumed')
      },
    })

    await expect(sendEmail(PARAMS)).rejects.toThrow('Resend send failed: 500')
  })

  it('propagates a network failure rather than reporting a send', async () => {
    const { sendEmail } = await loadEmail({ RESEND_API_KEY: 're_test_key' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )

    await expect(sendEmail(PARAMS)).rejects.toThrow('ECONNREFUSED')
  })
})

describe('buildVerificationEmail', () => {
  it('carries the verification link in both the html and the text part', async () => {
    const { buildVerificationEmail } = await loadEmail({})
    const url = 'https://kerjacus.id/verify?token=abc123'

    const mail = buildVerificationEmail('Budi', url)

    expect(mail.subject).toBeTruthy()
    // A mail client that renders text-only still has to be able to verify.
    expect(mail.html).toContain(`href="${url}"`)
    expect(mail.text).toContain(url)
  })

  it('addresses the recipient by name', async () => {
    const { buildVerificationEmail } = await loadEmail({})

    const mail = buildVerificationEmail('Budi', 'https://kerjacus.id/verify')

    expect(mail.html).toContain('Budi')
    expect(mail.text).toContain('Budi')
  })
})
