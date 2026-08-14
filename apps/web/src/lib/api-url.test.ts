import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * API_BASE_URL reads import.meta.env at module load, so which side of its `??`
 * runs is decided before any test body does.
 *
 * That made coverage depend on the developer's .env. The root script wraps
 * turbo in dotenv and the workspace script does not, so the same suite reported
 * 27 of 50 branches one way and 26 the other, and the gate failed depending on
 * how it was invoked. Stubbing the variable and re-importing covers both sides
 * in either environment.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function loadWith(value: string | undefined) {
  vi.resetModules()
  if (value === undefined) {
    vi.stubEnv('VITE_API_URL', '')
  } else {
    vi.stubEnv('VITE_API_URL', value)
  }
  return await import('./api-url')
}

describe('API_BASE_URL', () => {
  it('uses the configured base in production', async () => {
    const { API_BASE_URL, apiUrl } = await loadWith('https://api.kerjacus.id')

    expect(API_BASE_URL).toBe('https://api.kerjacus.id')
    expect(apiUrl('/api/v1/projects')).toBe('https://api.kerjacus.id/api/v1/projects')
  })

  /** Dev leaves it empty so Vite's proxy sees a same-origin path. */
  it('falls back to a relative base when unset', async () => {
    const { API_BASE_URL, apiUrl } = await loadWith(undefined)

    expect(API_BASE_URL).toBe('')
    expect(apiUrl('/api/v1/projects')).toBe('/api/v1/projects')
  })
})

describe('resolveUrl', () => {
  it('passes an absolute URL through untouched', async () => {
    const { resolveUrl } = await loadWith('https://api.kerjacus.id')

    expect(resolveUrl('https://storage.example/cv.pdf')).toBe('https://storage.example/cv.pdf')
    expect(resolveUrl('http://localhost:9000/bucket/key')).toBe('http://localhost:9000/bucket/key')
  })

  it('prefixes a relative path with the base', async () => {
    const { resolveUrl } = await loadWith('https://api.kerjacus.id')

    expect(resolveUrl('/health')).toBe('https://api.kerjacus.id/health')
  })

  /** A presigned URL is absolute, so it must never be rewritten. */
  it('does not treat a scheme-like substring as absolute', async () => {
    const { resolveUrl } = await loadWith('https://api.kerjacus.id')

    expect(resolveUrl('/redirect?to=https://evil.example')).toBe(
      'https://api.kerjacus.id/redirect?to=https://evil.example',
    )
  })
})
