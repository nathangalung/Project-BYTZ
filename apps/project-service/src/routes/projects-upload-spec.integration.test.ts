// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  chatConversations,
  chatMessages,
  getDb,
  projects as projectsTable,
  user,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetServicePolicies } from '../lib/resilience'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { projectsRoute } from './projects'

/**
 * Uploading an existing specification to seed the scoping chat.
 *
 * The whole point of this route is that the assistant reads the document, so
 * an upload the AI service never parsed is a failure however successfully the
 * file was stored. It used to report success anyway and promise parsing
 * "shortly", with nothing queuing or retrying it - the owner was left with a
 * document the assistant had never seen and no way to tell. That is the branch
 * that matters here: every path where parsing does not happen must be an
 * error, and none of them may leave a half-written scoping thread behind.
 *
 * The status gate is the other half. A spec seeds scoping, so it only makes
 * sense before the BRD exists; accepting one later would silently do nothing
 * to a document already generated from a different conversation.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'owner'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function app(caller: SessionUser | null) {
  const a = new Hono()
  a.onError(errorHandler)
  a.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  a.route('/', projectsRoute)
  return a
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type OkBody = { success: true; data: { message: string; summary: string; completeness: number } }

const FILE_URL = 'https://storage.example.test/document/spec.pdf'

runIf('spec upload against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let strangerId: string
  let projectId: string

  let aiStatus: number
  let aiBody: unknown
  let aiCalls: { file_url: string; file_type: string; notes?: string }[]

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
    aiBody = { data: { summary: 'A marketplace with escrow', completeness: 65 } }
    resetServicePolicies()

    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      aiCalls.push(JSON.parse(String(init?.body ?? '{}')) as (typeof aiCalls)[number])
      if (aiStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'parser unavailable' } }), {
          status: aiStatus,
        })
      }
      return new Response(JSON.stringify(aiBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    ownerId = await makeUser('owner')
    strangerId = await makeUser('stranger')
    projectId = await makeProject('scoping')
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

  async function makeProject(status: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projectsTable).values({
      id,
      ownerId,
      title: 'Marketplace',
      description: 'A managed marketplace for digital projects',
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: status as 'scoping',
    })
    return id
  }

  function upload(caller: SessionUser | null, body: unknown, project = projectId) {
    return app(caller).request(`/${project}/upload-spec`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function validBody(overrides: Record<string, unknown> = {}) {
    return { fileUrl: FILE_URL, fileType: 'pdf', ...overrides }
  }

  async function scopingMessages() {
    const [conversation] = await handle.db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(eq(chatConversations.projectId, projectId))
    if (!conversation) return []
    return await handle.db
      .select({
        senderType: chatMessages.senderType,
        content: chatMessages.content,
        metadata: chatMessages.metadata,
      })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
  }

  describe('a parsed specification', () => {
    it('seeds the scoping thread with what the parser read', async () => {
      const res = await upload(session(ownerId), validBody())

      expect(res.status).toBe(200)
      expect((await res.json()) as OkBody).toMatchObject({
        data: { summary: 'A marketplace with escrow', completeness: 65 },
      })
      const messages = await scopingMessages()
      expect(messages).toHaveLength(1)
      expect(messages[0].senderType).toBe('system')
      expect(messages[0].content).toContain('[Uploaded specification: PDF]')
      expect(messages[0].content).toContain('A marketplace with escrow')
    })

    /** The file is recorded on the message so the document is traceable. */
    it('records the source document on the seeded message', async () => {
      await upload(session(ownerId), validBody({ fileType: 'docx' }))

      expect((await scopingMessages())[0].metadata).toMatchObject({
        fileUrl: FILE_URL,
        fileType: 'docx',
      })
    })

    it('forwards the file and the owner notes to the parser', async () => {
      await upload(session(ownerId), validBody({ notes: 'Fokus ke modul pembayaran' }))

      expect(aiCalls[0]).toMatchObject({
        file_url: FILE_URL,
        file_type: 'pdf',
        notes: 'Fokus ke modul pembayaran',
      })
    })

    /** A parser that returns no summary still produces a usable thread. */
    it('falls back to a generic summary when the parser reports none', async () => {
      aiBody = { data: {} }

      const res = await upload(session(ownerId), validBody())

      expect((await res.json()) as OkBody).toMatchObject({
        data: { summary: 'Specification document uploaded and parsed.', completeness: 80 },
      })
    })

    it('tolerates a response with no data envelope at all', async () => {
      aiBody = {}

      const res = await upload(session(ownerId), validBody())

      expect(res.status).toBe(200)
      expect(await scopingMessages()).toHaveLength(1)
    })

    it.each(['pdf', 'docx', 'pptx', 'txt'])('accepts a %s specification', async (fileType) => {
      const res = await upload(session(ownerId), validBody({ fileType }))

      expect(res.status).toBe(200)
      expect(aiCalls[0].file_type).toBe(fileType)
    })
  })

  describe('refusals', () => {
    it('refuses a caller who does not own the project', async () => {
      const res = await upload(session(strangerId), validBody())

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(aiCalls).toHaveLength(0)
    })

    /**
     * Reported as a refusal rather than a 404, so a stranger probing ids
     * cannot tell an absent project from someone else's.
     */
    it('refuses a project that does not exist', async () => {
      const res = await upload(session(ownerId), validBody(), uuidv7())

      expect(res.status).toBe(403)
      expect(aiCalls).toHaveLength(0)
    })

    it('requires a session', async () => {
      const res = await upload(null, validBody())

      expect(res.status).toBe(401)
    })

    /**
     * A spec seeds the scoping conversation, so it only makes sense before a
     * document exists. Accepting one afterwards would append to a thread the
     * BRD was already generated from and change nothing the owner can see.
     */
    it.each(['brd_generated', 'prd_approved', 'in_progress', 'completed'])(
      'refuses an upload once the project reached %s',
      async (status) => {
        const later = await makeProject(status)

        const res = await upload(session(ownerId), validBody(), later)

        expect(res.status).toBe(400)
        expect(((await res.json()) as ErrorBody).error.message).toContain('draft or scoping status')
        expect(aiCalls).toHaveLength(0)
      },
    )

    it('accepts an upload while the project is still a draft', async () => {
      const draft = await makeProject('draft')

      const res = await upload(session(ownerId), validBody(), draft)

      expect(res.status).toBe(200)
    })

    it.each([
      ['a file URL that is not a URL', { fileUrl: 'not-a-url', fileType: 'pdf' }],
      ['an unsupported file type', { fileUrl: FILE_URL, fileType: 'exe' }],
      ['no file at all', { fileType: 'pdf' }],
      [
        'notes past the length bound',
        { fileUrl: FILE_URL, fileType: 'pdf', notes: 'x'.repeat(2001) },
      ],
    ])('rejects %s', async (_label, body) => {
      const res = await upload(session(ownerId), body)

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
      expect(aiCalls).toHaveLength(0)
    })
  })

  describe('when the parser does not read the document', () => {
    /**
     * The regression this exists to prevent: reporting success for an upload
     * that was never parsed. The owner is told plainly to try again rather
     * than left waiting for a queue that does not exist.
     */
    it('reports a failure rather than a stored-but-unread success', async () => {
      aiStatus = 503

      const res = await upload(session(ownerId), validBody())

      expect(res.status).toBe(503)
      const body = (await res.json()) as ErrorBody
      expect(body.error.code).toBe('AI_SERVICE_UNAVAILABLE')
      expect(body.error.message).toContain('could not be read')
    })

    it('leaves no half-seeded scoping thread behind', async () => {
      aiStatus = 503

      await upload(session(ownerId), validBody())

      expect(await scopingMessages()).toEqual([])
    })

    it('leaves a draft project in draft', async () => {
      const draft = await makeProject('draft')
      aiStatus = 503

      await upload(session(ownerId), validBody(), draft)

      const [row] = await handle.db
        .select({ status: projectsTable.status })
        .from(projectsTable)
        .where(eq(projectsTable.id, draft))
      expect(row.status).toBe('draft')
    })
  })
})
