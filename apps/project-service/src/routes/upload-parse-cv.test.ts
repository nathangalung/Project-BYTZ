import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signUploadKey } from '../lib/upload-token'

/**
 * The browser used to POST straight to the AI service, which reads no session.
 * That route now needs the shared secret, and this one is the replacement entry
 * point: it holds the session, so it is the only place ownership can be checked.
 *
 * The check that matters is the third test. Storage keys are opaque but not
 * secret, and the parse response carries the CV owner's name, email and phone.
 */

const SECRET = 'a-test-secret-at-least-32-characters-long'
const KEY = 'cv/0192f3a4-0000-7000-8000-000000000000.pdf'

let currentUserId = 'talent-1'
const fetchCalls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []

vi.mock('../lib/env', () => ({
  env: {
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_URL: '',
    S3_BUCKET: 'kerjacus-uploads',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    SERVICE_AUTH_SECRET: SECRET,
    AI_SERVICE_URL: 'http://ai-service:3003',
  },
}))

vi.mock('../middleware/session', () => ({
  getAuthUser: () => ({ id: currentUserId }),
}))

const { Hono } = await import('hono')
const { uploadRoute } = await import('./upload')
const { errorHandler } = await import('../middleware/error-handler')

// Mounted like index.ts, so AppError maps to its status.
const app = new Hono().route('/upload', uploadRoute)
app.onError(errorHandler)

beforeEach(() => {
  currentUserId = 'talent-1'
  fetchCalls.length = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    })
    return new Response(JSON.stringify({ parsed_data: { name: 'Jane' } }), { status: 200 })
  })
})

function parseCv(body: unknown) {
  return app.request('/upload/parse-cv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /parse-cv', () => {
  it('parses a key the caller was given', async () => {
    const res = await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(res.status).toBe(200)
    expect(fetchCalls).toHaveLength(1)
  })

  it('rejects a request with no token', async () => {
    const res = await parseCv({ key: KEY })
    expect(res.status).toBe(400)
    expect(fetchCalls).toHaveLength(0)
  })

  // Read another talent's CV using their storage key.
  it('rejects a key minted for a different user', async () => {
    const stolen = signUploadKey(KEY, 'talent-2', SECRET)
    const res = await parseCv({ key: KEY, token: stolen })
    expect(res.status).toBe(403)
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects a token from a different key', async () => {
    const token = signUploadKey('cv/mine.pdf', 'talent-1', SECRET)
    const res = await parseCv({ key: KEY, token })
    expect(res.status).toBe(403)
    expect(fetchCalls).toHaveLength(0)
  })

  it('sends the inter-service secret downstream', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(fetchCalls[0].headers['X-Service-Auth']).toBe(SECRET)
  })

  it('names the session user, not a caller-supplied id', async () => {
    await parseCv({
      key: KEY,
      token: signUploadKey(KEY, 'talent-1', SECRET),
      talent_id: 'someone-else',
    })
    expect((fetchCalls[0].body as { talent_id: string }).talent_id).toBe('talent-1')
  })

  it('sends a presigned URL, not a bare key', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    const sent = (fetchCalls[0].body as { file_url: string }).file_url
    // Bucket stays private, so the read has to carry a signature.
    expect(sent).toContain('X-Amz-Signature')
    expect(sent).toContain('minio:9000')
  })

  it('reports upstream failure instead of an empty parse', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 502 }))
    const res = await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
