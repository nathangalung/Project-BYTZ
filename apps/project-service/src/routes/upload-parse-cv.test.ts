import { getTableName } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
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
let existingProfile: Array<{ id: string; verificationStatus?: string; updatedAt?: Date }> = []
type Write = { op: 'update' | 'insert'; values: Record<string, unknown> }
const writes: Write[] = []
/** The education and project rows, which are inserted a set at a time. */
const rowWrites: Record<string, unknown>[][] = []

/**
 * A parse now claims the talent by moving them into cv_parsing before the call
 * and putting the previous status back if it fails, so every run writes twice
 * more than it used to. Those writes are the guard, not the parse result, and
 * the assertions below are about the result; parseWrites drops them.
 */
function parseWrites(): Write[] {
  // Every write about the CV names the key it concerns; the guard never does.
  return writes.filter((w) => 'cvFileUrl' in w.values)
}

// Recorded when the statement is built, so the same object serves a plain
// awaited write and a conditional one that unwraps through .returning().
const CLAIMED = [{ id: 'profile-1' }]

function settled(values: Record<string, unknown>, op: 'update' | 'insert') {
  writes.push({ op, values })
  return {
    returning: async () => CLAIMED,
    onConflictDoNothing: () => ({ returning: async () => CLAIMED }),
  }
}

function settledRows(rows: Record<string, unknown>[]) {
  rowWrites.push(rows)
  return { returning: async () => CLAIMED }
}

/**
 * The parse writes the profile and the education and project rows it produced
 * in one transaction, so the fake has to be able to be a transaction: it hands
 * the same handle back, which is enough because nothing here rolls one back.
 */
const deletes: string[] = []

type FakeDb = {
  select: () => { from: () => { where: () => { limit: () => Promise<unknown[]> } } }
  update: () => { set: (v: Record<string, unknown>) => { where: () => unknown } }
  insert: () => { values: (v: Record<string, unknown> | Record<string, unknown>[]) => unknown }
  delete: (table: PgTable) => { where: () => Promise<void> }
  transaction: (fn: (tx: FakeDb) => Promise<void>) => Promise<void>
}

const fakeDb: FakeDb = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => existingProfile }) }) }),
  update: () => ({
    set: (v: Record<string, unknown>) => ({ where: () => settled(v, 'update') }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown> | Record<string, unknown>[]) =>
      Array.isArray(v) ? settledRows(v) : settled(v, 'insert'),
  }),
  delete: (table: PgTable) => ({
    where: async () => {
      deletes.push(getTableName(table))
    },
  }),
  transaction: async (fn: (tx: FakeDb) => Promise<void>) => {
    await fn(fakeDb)
  },
}

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => fakeDb,
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
  rowWrites.length = 0
  deletes.length = 0
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
    expect(parseWrites()).toHaveLength(1)
    expect(parseWrites()[0].values.cvParsedData).toEqual({ name: 'Jane' })
    expect(parseWrites()[0].values.cvFileUrl).toBe(KEY)
  })

  it('verifies the talent on a confident parse', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()[0].values.verificationStatus).toBe('verified')
  })

  it('leaves a talent unverified when the parse recovered nothing', async () => {
    parseResponse = { parsed_data: {}, confidence_score: 0 }
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()[0].values.verificationStatus).toBe('unverified')
  })

  // Registration parses the CV before submitting the rest of the form.
  it('creates the profile when none exists yet', async () => {
    existingProfile = []
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()[0].op).toBe('insert')
    expect(parseWrites()[0].values.userId).toBe('talent-1')
    expect(parseWrites()[0].values.verificationStatus).toBe('verified')
  })

  it('updates in place when the profile exists', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()[0].op).toBe('update')
  })

  /**
   * The parse returns every degree and every project with its stack, and all
   * of it used to end in the blob no external reader may open. The rows below
   * are what an owner is shown and what the talent's own profile lists.
   */
  const RICH_CV = {
    education: [
      { university: 'Institut Teknologi Bandung', degree: 'S2', major: 'Informatika', end: '2021' },
      {
        university: 'Universitas Indonesia',
        degree: 'S1',
        major: 'Ilmu Komputer',
        gpa: '3.60',
        start: '2013',
        end: 'Juni 2017',
      },
    ],
    projects: [
      {
        title: 'Nusantara Pay',
        description: 'Agregator payment gateway',
        tech_stack: ['Go', 'PostgreSQL'],
        url: 'https://github.com/x/nusantara-pay',
      },
    ],
  }

  it('writes a row per degree, in the order the parse gave them', async () => {
    parseResponse = { parsed_data: RICH_CV, confidence_score: 0.9 }
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })

    const education = rowWrites.find((rows) => 'university' in rows[0])
    expect(education).toHaveLength(2)
    expect(education?.[0]).toMatchObject({
      university: 'Institut Teknologi Bandung',
      degree: 'S2',
      orderIndex: 0,
      talentId: 'profile-1',
    })
    // The year is read out of whatever the CV wrote it as.
    expect(education?.[1]).toMatchObject({ startYear: 2013, endYear: 2017, gpa: '3.60' })
  })

  it('writes the projects with their tech stack', async () => {
    parseResponse = { parsed_data: RICH_CV, confidence_score: 0.9 }
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })

    const projects = rowWrites.find((rows) => 'title' in rows[0])
    expect(projects).toHaveLength(1)
    expect(projects?.[0]).toMatchObject({
      title: 'Nusantara Pay',
      techStack: ['Go', 'PostgreSQL'],
      url: 'https://github.com/x/nusantara-pay',
    })
  })

  it('replaces the previous set rather than appending to it', async () => {
    parseResponse = { parsed_data: RICH_CV, confidence_score: 0.9 }
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })

    expect(deletes).toEqual(['talent_education', 'talent_projects'])
  })

  /**
   * /reparse-cv is a button on the profile page. A scan the parser reads badly
   * must not delete education the talent has since corrected by hand.
   */
  it('leaves the stored rows alone when the parse extracted none', async () => {
    parseResponse = { parsed_data: { name: 'Jane' }, confidence_score: 0.9 }
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })

    expect(deletes).toEqual([])
    expect(rowWrites).toEqual([])
  })

  it('writes nothing when the token does not match', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-2', SECRET) })
    expect(writes).toHaveLength(0)
  })

  // Without this the file sits at a key nobody saved, and the re-parse button
  // (gated on cvFileUrl) never shows for the failure it exists to recover.
  it('records the CV key when parsing fails, without a fake parse', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 502 }))
    const res = await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(parseWrites()).toHaveLength(1)
    expect(parseWrites()[0].values.cvFileUrl).toBe(KEY)
    expect(parseWrites()[0].values.cvParsedData).toBeUndefined()
    expect(parseWrites()[0].values.verificationStatus).toBeUndefined()
  })
})

/**
 * Storage answering 404 means the object is gone. Reporting that as an outage
 * offers a retry that cannot work, and leaves the re-parse button (gated on
 * cvFileUrl) pointing at a key nothing will ever serve.
 */
describe('a CV storage no longer holds', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response('no such key', { status: 404 }))
  })

  it('reports a missing CV rather than an unavailable service', async () => {
    const res = await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CV_FILE_MISSING')
  })

  it('forgets the dead key so the re-parse button stops offering a retry', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()).toHaveLength(1)
    expect(parseWrites()[0].op).toBe('update')
    expect(parseWrites()[0].values.cvFileUrl).toBeNull()
  })

  it('leaves an existing parse alone while clearing the key', async () => {
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()[0].values.cvParsedData).toBeUndefined()
    expect(parseWrites()[0].values.verificationStatus).toBeUndefined()
  })

  // The claim creates a stub row before the call, so the guarantee is no
  // longer "no row" but "no row that remembers a key storage will never serve".
  it('records no CV key for a file that was never stored', async () => {
    existingProfile = []
    await parseCv({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) })
    expect(parseWrites()).toHaveLength(0)
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
