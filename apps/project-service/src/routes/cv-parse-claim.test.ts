import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signUploadKey } from '../lib/upload-token'

/**
 * Parsing a CV is a billed, non-idempotent Gemini call, and both routes that
 * start one ran with no guard at all. Two tabs meant two parses of the same
 * file and two invoices, with nothing left behind to notice it.
 *
 * verification_status already declares 'cv_parsing', and nothing ever wrote it,
 * so the documented unverified -> cv_parsing -> verified flow never happened.
 * Marking that state is the claim: a conditional UPDATE only lands while the
 * row still holds the status it was read at, so exactly one caller may enter
 * cv_parsing and the rest are refused.
 *
 * The claim is taken BEFORE the call. That costs a talent their real status if
 * the call then fails, so every failure hands it back -- and hands back the
 * status the claim overwrote, because a verified talent whose re-parse fails
 * must not silently drop to unverified.
 */

const SECRET = 'a-test-secret-at-least-32-characters-long'
const KEY = 'cv/0192f3a4-0000-7000-8000-000000000000.pdf'

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
  getAuthUser: () => ({ id: 'talent-1' }),
}))

type Write = { op: 'update' | 'insert'; values: Record<string, unknown> }

let profileRows: Array<Record<string, unknown>> = []
/** Rows the next conditional write reports back. Empty means the race was lost. */
let claimReturning: Array<{ id: string }> = []
const writes: Write[] = []
/** Ordered log, so "claimed before the model was called" is checkable. */
const events: string[] = []

function record(op: 'update' | 'insert', values: Record<string, unknown>): void {
  writes.push({ op, values })
  if (values.verificationStatus === 'cv_parsing') events.push('claim')
}

// Recorded when the statement is built, so the same object serves a plain
// awaited write and a conditional one that unwraps through .returning().
function settled(values: Record<string, unknown>, op: 'update' | 'insert') {
  record(op, values)
  return {
    returning: async () => claimReturning,
    onConflictDoNothing: () => ({ returning: async () => claimReturning }),
  }
}

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => profileRows }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({ where: () => settled(v, 'update') }),
    }),
    insert: () => ({ values: (v: Record<string, unknown>) => settled(v, 'insert') }),
  }),
}))

const { Hono } = await import('hono')
const { uploadRoute } = await import('./upload')
const { errorHandler } = await import('../middleware/error-handler')

const app = new Hono().route('/upload', uploadRoute)
app.onError(errorHandler)

beforeEach(() => {
  writes.length = 0
  events.length = 0
  profileRows = [{ id: 'profile-1', verificationStatus: 'unverified', updatedAt: new Date() }]
  claimReturning = [{ id: 'profile-1' }]
  vi.stubGlobal('fetch', async () => {
    events.push('ai-call')
    return new Response(JSON.stringify({ parsed_data: { name: 'Jane' }, confidence_score: 0.9 }), {
      status: 200,
    })
  })
})

function parseCv() {
  return app.request('/upload/parse-cv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, token: signUploadKey(KEY, 'talent-1', SECRET) }),
  })
}

describe('a CV parse claims the talent before spending the model call', () => {
  it('marks cv_parsing before calling the AI service', async () => {
    await parseCv()
    expect(events).toEqual(['claim', 'ai-call'])
  })

  it('refuses a second caller instead of parsing the file twice', async () => {
    // The conditional UPDATE matched nothing: someone else holds cv_parsing.
    claimReturning = []
    const res = await parseCv()
    expect(res.status).toBe(409)
    expect(events).not.toContain('ai-call')
  })

  it('records the parse result over its own claim on success', async () => {
    await parseCv()
    expect(writes.at(-1)?.values.verificationStatus).toBe('verified')
  })
})

/**
 * The talent held a real status before the claim overwrote it. Handing back
 * 'unverified' would revoke a verified talent's standing for an outage that
 * says nothing about their CV.
 */
describe('a failed parse hands the previous status back', () => {
  beforeEach(() => {
    profileRows = [{ id: 'profile-1', verificationStatus: 'verified', updatedAt: new Date() }]
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 502 }))
  })

  it('restores verified rather than dropping the talent to unverified', async () => {
    const res = await parseCv()
    expect(res.status).toBeGreaterThanOrEqual(500)
    const restored = writes.filter((w) => w.values.verificationStatus === 'verified')
    expect(restored).toHaveLength(1)
  })

  it('leaves nobody sitting in cv_parsing after the failure', async () => {
    await parseCv()
    expect(writes.at(-1)?.values.verificationStatus).not.toBe('cv_parsing')
  })

  // Storage 404 clears the dead key, and must not strand the status either.
  it('restores the status when the CV is gone from storage', async () => {
    vi.stubGlobal('fetch', async () => new Response('no such key', { status: 404 }))
    const res = await parseCv()
    expect(res.status).toBe(404)
    expect(writes.some((w) => w.values.verificationStatus === 'verified')).toBe(true)
  })
})

const claimLib = readFileSync(path.resolve(__dirname, '../lib/cv-verification.ts'), 'utf8')
const route = readFileSync(path.resolve(__dirname, './upload.ts'), 'utf8')
const runCvParse = route.slice(route.indexOf('async function runCvParse'))

describe('the shape of the guard', () => {
  it('claims through a conditional update rather than a read-then-write', () => {
    // The WHERE carries the status that was read, so a second caller holding
    // the same value updates nothing and is turned away.
    expect(claimLib).toContain('eq(talentProfiles.verificationStatus, existing.verificationStatus)')
    // A talent with no profile row yet has nothing to update, so the insert is
    // the claim; user_id is unique, so only one of two concurrent parses lands.
    expect(claimLib).toContain('onConflictDoNothing')
  })

  it('turns a lost race away with a conflict', () => {
    expect(claimLib).toContain('CONFLICT')
  })

  /**
   * The release names the value the claim wrote, so it can only undo its own
   * claim and never clobber a status someone else legitimately moved to.
   */
  it('scopes the release to the status the claim wrote', () => {
    const release = claimLib.slice(claimLib.indexOf('export async function releaseCvParse'))
    expect(release).toContain("eq(talentProfiles.verificationStatus, 'cv_parsing')")
  })

  /**
   * A process killed mid-parse must not leave a talent in cv_parsing forever,
   * unable to ever parse again.
   */
  it('reclaims a claim whose parse could no longer be running', () => {
    expect(claimLib).toContain('TIMEOUT_MS.cvParse')
    expect(claimLib).toMatch(/lt\(talentProfiles\.updatedAt, \w+\)/)
  })

  it('claims before the model call, not after', () => {
    const claimAt = runCvParse.indexOf('claimCvParse(')
    const callAt = runCvParse.indexOf('serviceFetch(')
    expect(claimAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(-1)
    expect(claimAt).toBeLessThan(callAt)
  })

  /**
   * The release belongs to the failed call alone. A finally would also run
   * after a call that succeeded, handing back a claim the parse result has
   * already overwritten with a real status.
   */
  it('releases in the catch around the call, not in a finally', () => {
    expect(runCvParse).toContain('releaseCvParse(')
    expect(runCvParse).not.toMatch(/}\s*finally\s*{/)
    const catchAt = runCvParse.indexOf('} catch (err) {')
    const releaseAt = runCvParse.indexOf('releaseCvParse(')
    expect(releaseAt).toBeGreaterThan(catchAt)
    // Nothing after the call is released: it ran on a parse already paid for.
    expect(releaseAt).toBeLessThan(runCvParse.indexOf('persistCvParse('))
  })
})
