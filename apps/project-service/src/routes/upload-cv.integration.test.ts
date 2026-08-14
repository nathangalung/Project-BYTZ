// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import { getDb, talentProfiles, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetServicePolicies } from '../lib/resilience'
import { signUploadKey } from '../lib/upload-token'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { uploadRoute } from './upload'

/**
 * CV upload and parsing, which decides whether a talent is visible at all.
 *
 * The AI route this proxies returns name, email, phone, education and
 * employment history, and it checks only that the key points at project
 * storage - not who owns it. The browser used to call it directly, so any
 * signed-in user could read any other talent's parsed CV by guessing a key.
 * The upload token is what closed that, and it is asserted here rather than
 * inferred from the source.
 *
 * The failure paths are the other half. CV parsing is the only vetting stage,
 * so a claim taken before the model call and not handed back on failure
 * revokes a verified talent's standing over an outage that says nothing about
 * their CV. The three outcomes are deliberately different: a 404 from storage
 * forgets the key, because a retry against a missing object can never succeed;
 * any other upstream failure remembers it, so the talent can re-parse instead
 * of losing a file nobody saved; and both restore the status the claim
 * overwrote.
 *
 * The ai-service is stubbed. S3 presigning is pure local signing and does not
 * reach the network, so it runs for real.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`
const SECRET = 'test-service-auth-secret'

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function app(caller: SessionUser | null) {
  const a = new Hono()
  a.onError(errorHandler)
  a.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  a.route('/', uploadRoute)
  return a
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type PresignBody = { success: true; data: { url: string; key: string; token: string } }

runIf('CV upload and parsing against Postgres', () => {
  let handle: TestHandle
  let talentUserId: string
  let otherUserId: string

  let aiStatus: number
  let aiBody: unknown
  let aiCalls: { talent_id: string; file_url: string; file_type: string }[]

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    aiStatus = 200
    aiCalls = []
    aiBody = {
      parsed_data: { nama: 'Sri', skills: ['react', 'go'] },
      confidence_score: 0.9,
    }
    resetServicePolicies()

    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      aiCalls.push(JSON.parse(String(init?.body ?? '{}')) as (typeof aiCalls)[number])
      if (aiStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'parser down' } }), {
          status: aiStatus,
        })
      }
      return new Response(JSON.stringify(aiBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    talentUserId = await makeUser('talent')
    otherUserId = await makeUser('other')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function makeProfile(
    userId: string,
    status: 'unverified' | 'verified' | 'cv_parsing' = 'unverified',
    cvFileUrl: string | null = null,
  ): Promise<void> {
    await handle.db
      .insert(talentProfiles)
      .values({ id: uuidv7(), userId, verificationStatus: status, cvFileUrl })
  }

  async function profileOf(userId: string) {
    const [row] = await handle.db
      .select()
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId))
    return row
  }

  function post(caller: SessionUser | null, path: string, body: unknown) {
    return app(caller).request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  describe('POST /presigned-url', () => {
    it('mints a key, a signed URL and a token that binds the key to the caller', async () => {
      const res = await post(session(talentUserId), '/presigned-url', {
        fileName: 'cv.pdf',
        fileType: 'application/pdf',
        folder: 'cv',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as PresignBody
      expect(body.data.key).toMatch(/^cv\/[0-9a-f-]+\.pdf$/)
      expect(body.data.url).toContain(body.data.key)
      // The token is what proves this caller was handed this key.
      expect(body.data.token).toBe(signUploadKey(body.data.key, talentUserId, SECRET))
    })

    /** A random filename, not the user's, so a name cannot traverse the path. */
    it('does not use the caller-supplied file name as the key', async () => {
      const res = await post(session(talentUserId), '/presigned-url', {
        fileName: '../../etc/passwd.pdf',
        fileType: 'application/pdf',
        folder: 'cv',
      })

      const body = (await res.json()) as PresignBody
      expect(body.data.key).not.toContain('..')
      expect(body.data.key).not.toContain('passwd')
    })

    it('refuses a folder outside the allowed set', async () => {
      const res = await post(session(talentUserId), '/presigned-url', {
        fileName: 'cv.pdf',
        fileType: 'application/pdf',
        folder: 'etc',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('refuses a request with no file name', async () => {
      const res = await post(session(talentUserId), '/presigned-url', {
        fileName: '',
        fileType: 'application/pdf',
        folder: 'cv',
      })

      expect(res.status).toBe(400)
    })

    it('requires a session', async () => {
      const res = await post(null, '/presigned-url', {
        fileName: 'cv.pdf',
        fileType: 'application/pdf',
        folder: 'cv',
      })

      expect(res.status).toBe(401)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_UNAUTHORIZED')
    })

    it('falls back to a bin extension when the name ends in a bare dot', async () => {
      const res = await post(session(talentUserId), '/presigned-url', {
        fileName: 'resume.',
        fileType: 'application/pdf',
        folder: 'cv',
      })

      expect(((await res.json()) as PresignBody).data.key).toMatch(/\.bin$/)
    })

    /**
     * A name with no dot at all takes the whole name as the extension, because
     * `'resume'.split('.').pop()` is `'resume'` rather than undefined and the
     * `|| 'bin'` fallback never fires. Harmless - the key is still a random
     * uuid and the extension is only a hint - but it is what happens, so it is
     * recorded rather than assumed to be `.bin`.
     */
    it('uses a dotless name as the extension rather than the bin fallback', async () => {
      const res = await post(session(talentUserId), '/presigned-url', {
        fileName: 'resume',
        fileType: 'application/pdf',
        folder: 'cv',
      })

      expect(((await res.json()) as PresignBody).data.key).toMatch(/\.resume$/)
    })
  })

  describe('POST /parse-cv', () => {
    function tokenFor(key: string, userId: string): string {
      return signUploadKey(key, userId, SECRET)
    }

    it('parses the CV and verifies the talent', async () => {
      const key = `cv/${uuidv7()}.pdf`

      const res = await post(session(talentUserId), '/parse-cv', {
        key,
        token: tokenFor(key, talentUserId),
      })

      expect(res.status).toBe(200)
      const profile = await profileOf(talentUserId)
      expect(profile.verificationStatus).toBe('verified')
      expect(profile.cvFileUrl).toBe(key)
      expect(profile.cvParsedData).toMatchObject({ nama: 'Sri' })
    })

    /**
     * The access-control hole this route exists to close. The token binds the
     * key to the user it was issued to, so presenting someone else's key - or
     * your own token against a key you were not given - is refused before the
     * AI service is asked for anything.
     */
    it('refuses a key the caller was not issued a token for', async () => {
      const key = `cv/${uuidv7()}.pdf`

      const res = await post(session(otherUserId), '/parse-cv', {
        key,
        token: tokenFor(key, talentUserId),
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses a token that does not match the key', async () => {
      const res = await post(session(talentUserId), '/parse-cv', {
        key: `cv/${uuidv7()}.pdf`,
        token: tokenFor(`cv/${uuidv7()}.pdf`, talentUserId),
      })

      expect(res.status).toBe(403)
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses a forged token', async () => {
      const key = `cv/${uuidv7()}.pdf`

      const res = await post(session(talentUserId), '/parse-cv', { key, token: 'not-a-token' })

      expect(res.status).toBe(403)
      expect(aiCalls).toHaveLength(0)
    })

    it('rejects a request missing the token entirely', async () => {
      const res = await post(session(talentUserId), '/parse-cv', { key: 'cv/x.pdf' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    /**
     * A low-confidence parse is not a verification. 0.5 sits above the empty
     * parse the AI service reports as 0.0 and below the regex fallback's
     * ceiling, so a talent is not held back merely because the LLM path was
     * down - but a document that yielded nothing must not verify anyone.
     */
    it('leaves a talent unverified when the parse is unconvincing', async () => {
      const key = `cv/${uuidv7()}.pdf`
      aiBody = { parsed_data: {}, confidence_score: 0.1 }

      await post(session(talentUserId), '/parse-cv', { key, token: tokenFor(key, talentUserId) })

      expect((await profileOf(talentUserId)).verificationStatus).toBe('unverified')
    })

    it('leaves a talent unverified when no confidence is reported at all', async () => {
      const key = `cv/${uuidv7()}.pdf`
      aiBody = { parsed_data: { nama: 'Sri' } }

      await post(session(talentUserId), '/parse-cv', { key, token: tokenFor(key, talentUserId) })

      expect((await profileOf(talentUserId)).verificationStatus).toBe('unverified')
    })

    /**
     * The status the claim overwrote has to come back. An AI outage says
     * nothing about the CV, and revoking a verified talent's standing over one
     * makes them invisible to matching for reasons entirely outside their
     * control.
     */
    it('restores a verified talent’s standing when the parser is down', async () => {
      await makeProfile(talentUserId, 'verified')
      const key = `cv/${uuidv7()}.pdf`
      aiStatus = 503

      const res = await post(session(talentUserId), '/parse-cv', {
        key,
        token: tokenFor(key, talentUserId),
      })

      expect(res.status).toBe(503)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AI_SERVICE_UNAVAILABLE')
      expect((await profileOf(talentUserId)).verificationStatus).toBe('verified')
    })

    /** So the talent can retry rather than losing a file nobody saved. */
    it('remembers the uploaded key when parsing fails for any other reason', async () => {
      await makeProfile(talentUserId, 'verified')
      const key = `cv/${uuidv7()}.pdf`
      aiStatus = 503

      await post(session(talentUserId), '/parse-cv', { key, token: tokenFor(key, talentUserId) })

      expect((await profileOf(talentUserId)).cvFileUrl).toBe(key)
    })

    /**
     * A 404 is different in kind: storage no longer holds the object, so a
     * retry can never succeed. The key is forgotten, or the re-parse button
     * keeps offering a file that always fails.
     */
    it('forgets a key storage no longer holds', async () => {
      await makeProfile(talentUserId, 'verified', 'cv/old.pdf')
      const key = `cv/${uuidv7()}.pdf`
      aiStatus = 404

      const res = await post(session(talentUserId), '/parse-cv', {
        key,
        token: tokenFor(key, talentUserId),
      })

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CV_FILE_MISSING')
      const profile = await profileOf(talentUserId)
      expect(profile.cvFileUrl).toBeNull()
      expect(profile.verificationStatus).toBe('verified')
    })

    /**
     * Registration parses the CV before the rest of the form is submitted, so
     * there may be no profile row yet and the parse has to create the stub the
     * later profile write fills in.
     */
    it('creates the profile stub when registration parses before submitting', async () => {
      const key = `cv/${uuidv7()}.pdf`

      await post(session(talentUserId), '/parse-cv', { key, token: tokenFor(key, talentUserId) })

      expect(await profileOf(talentUserId)).toBeDefined()
    })

    /**
     * A first-time parse that 404s still leaves a profile row, because the
     * claim is the insert - there is nothing to update on a talent who has no
     * row yet, so reserving the parse creates one. What must NOT survive is
     * the key or the cv_parsing status: the row is left exactly as the old
     * failure path would have inserted it, unverified and holding no CV, so
     * the profile page offers an upload rather than a re-parse of a file that
     * is gone.
     */
    it('leaves a first-time 404 with an unverified profile holding no CV', async () => {
      const key = `cv/${uuidv7()}.pdf`
      aiStatus = 404

      await post(session(talentUserId), '/parse-cv', { key, token: tokenFor(key, talentUserId) })

      const profile = await profileOf(talentUserId)
      expect(profile.cvFileUrl).toBeNull()
      expect(profile.verificationStatus).toBe('unverified')
    })

    it('refuses a second parse while one is already running', async () => {
      await makeProfile(talentUserId, 'cv_parsing')
      const key = `cv/${uuidv7()}.pdf`

      const res = await post(session(talentUserId), '/parse-cv', {
        key,
        token: tokenFor(key, talentUserId),
      })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
      expect(aiCalls).toHaveLength(0)
    })

    it('sends the presigned URL and the file type upstream', async () => {
      const key = `cv/${uuidv7()}.docx`

      await post(session(talentUserId), '/parse-cv', { key, token: tokenFor(key, talentUserId) })

      expect(aiCalls[0].talent_id).toBe(talentUserId)
      expect(aiCalls[0].file_type).toBe('docx')
      // Presigned GET, so the bucket never has to be public.
      expect(aiCalls[0].file_url).toContain('X-Amz-Signature')
    })

    it('prefers an explicit file type over the key extension', async () => {
      const key = `cv/${uuidv7()}.bin`

      await post(session(talentUserId), '/parse-cv', {
        key,
        token: tokenFor(key, talentUserId),
        fileType: 'pdf',
      })

      expect(aiCalls[0].file_type).toBe('pdf')
    })
  })

  describe('POST /reparse-cv', () => {
    /**
     * Parsing runs once at registration and swallowed transient failures,
     * leaving the talent unverified and invisible to matching with no way
     * back. This is the way back, and it must not require re-uploading.
     */
    it('re-parses the CV already on file', async () => {
      await makeProfile(talentUserId, 'unverified', 'cv/stored.pdf')

      const res = await post(session(talentUserId), '/reparse-cv', {})

      expect(res.status).toBe(200)
      expect((await profileOf(talentUserId)).verificationStatus).toBe('verified')
      expect(aiCalls).toHaveLength(1)
    })

    it('refuses when there is no CV on file', async () => {
      await makeProfile(talentUserId, 'unverified', null)

      const res = await post(session(talentUserId), '/reparse-cv', {})

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses when the caller has no talent profile at all', async () => {
      const res = await post(session(talentUserId), '/reparse-cv', {})

      expect(res.status).toBe(404)
      expect(aiCalls).toHaveLength(0)
    })

    it('requires a session', async () => {
      const res = await post(null, '/reparse-cv', {})

      expect(res.status).toBe(401)
    })

    /** No token is presented, so the stored key is the only one reachable. */
    it('parses the stored key rather than one the caller names', async () => {
      await makeProfile(talentUserId, 'unverified', 'cv/stored.pdf')

      await post(session(talentUserId), '/reparse-cv', { key: 'cv/somebody-else.pdf' })

      expect(aiCalls[0].file_url).toContain('cv/stored.pdf')
    })
  })
})
