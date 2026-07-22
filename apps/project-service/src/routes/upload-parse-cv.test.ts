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

// Captures what persistCvParse writes to talent_profiles.
let existingProfile: Array<{ id: string }> = []
const writes: Array<{ op: 'update' | 'insert'; values: Record<string, unknown> }> = []

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => existingProfile }) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          writes.push({ op: 'update', values })
        },
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        writes.push({ op: 'insert', values })
      },
    }),
  }),
}))

const { Hono } = await import('hono')
const { uploadRoute } = await import('./upload')
const { errorHandler } = await import('../middleware/error-handler')

// Mounted like index.ts, so AppError maps to its status.
const app = new Hono().route('/upload', uploadRoute)
app.onError(errorHandler)

let parseResponse: Record<string, unknown> = {}

beforeEach(() => {
  currentUserId = 'talent-1'
  fetchCalls.length = 0
  writes.length = 0
  existingProfile = [{ id: 'profile-1' }]
  parseResponse = { parsed_data: { name: 'Jane' }, confidence_score: 0.9 }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    })
    return new Response(JSON.stringify(parseResponse), { status: 200 })
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

/**
 * Nothing wrote cv_parsed_data and nothing moved a talent off 'unverified',
 * while the matching query and the talent directory both require 'verified'.
 * A real talent could never be recommended for a project.
 */
describe('parse result persistence', () => {
  it('stores the parsed data and the key on the profile', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(writes).toHaveLength(1)
    expect(writes[0].values.cvParsedData).toEqual({ name: 'Jane' })
    expect(writes[0].values.cvFileUrl).toBe(KEY)
  })

  it('verifies the talent on a confident parse', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(writes[0].values.verificationStatus).toBe('verified')
  })

  it('leaves a talent unverified when the parse recovered nothing', async () => {
    parseResponse = { parsed_data: {}, confidence_score: 0 }
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(writes[0].values.verificationStatus).toBe('unverified')
  })

  // Registration parses the CV before submitting the rest of the form.
  it('creates the profile when none exists yet', async () => {
    existingProfile = []
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(writes[0].op).toBe('insert')
    expect(writes[0].values.userId).toBe('talent-1')
    expect(writes[0].values.verificationStatus).toBe('verified')
  })

  it('updates in place when the profile exists', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(writes[0].op).toBe('update')
  })

  it('writes nothing when the token does not match', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-2', SECRET) })
    expect(writes).toHaveLength(0)
  })
})

describe('profile edits do not revoke verification', () => {
  it('leaves verificationStatus alone on update', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./talent-profiles.ts', import.meta.url), 'utf8')
    const update = source.slice(source.indexOf('.update(talentProfiles)'))
    const setBlock = update.slice(0, update.indexOf('.where('))
    expect(setBlock).not.toContain('verificationStatus')
  })
})
