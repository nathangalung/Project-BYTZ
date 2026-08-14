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
 * The SSE scoping stream: the one route that answers 200 and then reports its
 * failures inside the body.
 *
 * That shape is why it needs testing rather than reading. The status line is
 * committed the moment the first byte goes out, so every downstream problem -
 * the model erroring mid-generation, a frame that will not parse, a database
 * that refuses the reply - has to become a frame instead. Each of those is a
 * separate branch inside one ReadableStream.start(), none of them changes the
 * status code, and none of them was executed.
 *
 * Two are worth naming. An UpstreamError's message carries the upstream
 * response body, which exists for the logs; emitting it would push internal
 * detail down the channel straight into the browser, so it is mapped to the
 * catalog message first. And a reply that streamed successfully but could not
 * be persisted still has to reach the owner, because the tokens are already on
 * their screen - what must not happen is a silent success.
 *
 * The refusals in front of the stream throw normally and get real status
 * codes, so both halves are asserted here: what is refused before a byte is
 * written, and what is reported after.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`
const MAX_SCOPING_MESSAGE_LENGTH = 4000
const SCOPING_HISTORY_WINDOW = 40

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
type Frame = {
  type: string
  delta?: string
  message?: string
  completeness?: number
  missing?: string[]
  suggestGenerateBrd?: boolean
}

/** An upstream SSE body built from raw frame text. */
function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
}

function dataFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

runIf('scoping chat stream against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let strangerId: string
  let projectId: string

  /** What the stubbed ai-service streams back, or how it fails. */
  let upstream: { status: number; frames: string[] | null }

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
    resetServicePolicies()
    upstream = {
      status: 200,
      frames: [
        dataFrame({ type: 'token', delta: 'Siapa ' }),
        dataFrame({ type: 'token', delta: 'target ' }),
        dataFrame({ type: 'token', delta: 'penggunanya?' }),
        dataFrame({ type: 'done', completeness_score: 45, missing: ['metrics'] }),
      ],
    }

    vi.stubGlobal('fetch', async () => {
      if (upstream.status !== 200) {
        return new Response(JSON.stringify({ error: { message: 'gemini quota exhausted' } }), {
          status: upstream.status,
        })
      }
      // A 2xx with no readable body is its own branch.
      if (upstream.frames === null) return new Response(null, { status: 200 })
      return new Response(sseBody(upstream.frames), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    ownerId = await makeUser('owner')
    strangerId = await makeUser('stranger')
    projectId = await makeProject()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // The persist-failure case spies on the db handle getDb() caches, so the
    // spy would otherwise still be installed for the tests after it in this
    // file. Not a cross-file concern - vitest's default isolate gives each
    // file a fresh module registry - but very much a cross-test one.
    vi.restoreAllMocks()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function makeProject(): Promise<string> {
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
      status: 'scoping',
    })
    return id
  }

  function stream(caller: SessionUser | null, body: unknown, project = projectId) {
    return app(caller).request(`/${project}/chat/stream`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /** Read the whole SSE response and parse every frame it emitted. */
  async function framesOf(res: Response): Promise<Frame[]> {
    const text = await res.text()
    return text
      .split('\n\n')
      .map((f) => f.trim())
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.slice(5).trim()) as Frame)
  }

  async function aiMessages(): Promise<string[]> {
    const [conversation] = await handle.db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(eq(chatConversations.projectId, projectId))
    if (!conversation) return []
    const rows = await handle.db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
    return rows.filter((r) => r.senderType === 'ai').map((r) => r.content ?? '')
  }

  describe('refusals before the stream opens', () => {
    it('refuses a caller who does not own the project', async () => {
      const res = await stream(session(strangerId), { content: 'Halo' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports a project that does not exist', async () => {
      const res = await stream(session(ownerId), { content: 'Halo' }, uuidv7())

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND')
    })

    it('rejects an empty message', async () => {
      const res = await stream(session(ownerId), { content: '   ' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('required')
    })

    it('rejects a message past the length bound', async () => {
      const res = await stream(session(ownerId), {
        content: 'x'.repeat(MAX_SCOPING_MESSAGE_LENGTH + 1),
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('too long')
    })
  })

  /**
   * The SSE turn bounds its input exactly as the JSON turn does, and it has to
   * be asserted separately: bounding one leaves the other as the cheaper way
   * in. Every turn used to ship the entire conversation upstream, so cost and
   * latency grew with the square of the session, and max_output_tokens is
   * capped on the AI side which left input as the last unbounded dimension.
   */
  describe('history window', () => {
    it('sends only the newest turns, oldest first, plus the system preamble', async () => {
      let sent: { role: string; content: string }[] = []
      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        sent = (JSON.parse(String(init?.body ?? '{}')) as { messages: typeof sent }).messages
        return new Response(sseBody(upstream.frames ?? []), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })

      const conversationId = uuidv7()
      await handle.db.insert(chatConversations).values({
        id: conversationId,
        projectId,
        type: 'ai_scoping',
        createdAt: new Date(),
      })
      const base = Date.now() - 1_000_000
      for (let i = 0; i < 60; i += 1) {
        await handle.db.insert(chatMessages).values({
          id: uuidv7(),
          conversationId,
          senderType: 'user',
          content: `turn-${i}`,
          createdAt: new Date(base + i * 1000),
        })
      }

      const res = await stream(session(ownerId), { content: 'turn-latest' })
      await framesOf(res)

      expect(sent[0].role).toBe('system')
      // 40 messages plus the preamble, and the 40 are the newest.
      expect(sent).toHaveLength(SCOPING_HISTORY_WINDOW + 1)
      const history = sent.slice(1)
      expect(history[0].content).toBe('turn-21')
      expect(history.at(-1)?.content).toBe('turn-latest')
      expect(history.map((m) => m.content)).not.toContain('turn-0')
    })
  })

  describe('a successful stream', () => {
    it('answers as an event stream that proxies must not buffer', async () => {
      const res = await stream(session(ownerId), { content: 'Butuh marketplace' })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('text/event-stream')
      // Without these an nginx or Traefik hop holds the whole reply and the
      // owner watches a spinner instead of tokens.
      expect(res.headers.get('Cache-Control')).toContain('no-transform')
      expect(res.headers.get('X-Accel-Buffering')).toBe('no')
    })

    it('forwards each token and closes with a done frame', async () => {
      const res = await stream(session(ownerId), { content: 'Butuh marketplace' })

      const frames = await framesOf(res)
      expect(frames.filter((f) => f.type === 'token').map((f) => f.delta)).toEqual([
        'Siapa ',
        'target ',
        'penggunanya?',
      ])
      const done = frames.at(-1)
      expect(done).toMatchObject({
        type: 'done',
        message: 'Siapa target penggunanya?',
        missing: ['metrics'],
        suggestGenerateBrd: false,
      })
    })

    /**
     * The body must be drained before asserting on what the stream did.
     * ReadableStream.start() runs asynchronously, so the Response is handed
     * back while the upstream read loop and the insert behind it are still in
     * flight - asserting without reading reports an empty thread every time.
     */
    it('persists the assembled reply as one AI message', async () => {
      const res = await stream(session(ownerId), { content: 'Butuh marketplace' })
      await framesOf(res)

      expect(await aiMessages()).toEqual(['Siapa target penggunanya?'])
    })

    /** The done frame's full_text is authoritative over the accumulated deltas. */
    it('prefers the full text the model reports at the end', async () => {
      upstream.frames = [
        dataFrame({ type: 'token', delta: 'partial' }),
        dataFrame({ type: 'done', full_text: 'the corrected full answer' }),
      ]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect((await framesOf(res)).at(-1)?.message).toBe('the corrected full answer')
      expect(await aiMessages()).toEqual(['the corrected full answer'])
    })

    it('suggests generating the BRD once the score reaches 80', async () => {
      upstream.frames = [
        dataFrame({ type: 'token', delta: 'Cukup lengkap' }),
        dataFrame({ type: 'done', completeness_score: 85 }),
      ]

      const res = await stream(session(ownerId), { content: 'Sudah semua' })

      expect((await framesOf(res)).at(-1)).toMatchObject({
        completeness: 85,
        suggestGenerateBrd: true,
      })
    })

    /** A model that lowballs a filled form must not drag progress backwards. */
    it('floors the completeness at what the form already established', async () => {
      upstream.frames = [
        dataFrame({ type: 'token', delta: 'Baik' }),
        dataFrame({ type: 'done', completeness_score: 0 }),
      ]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect((await framesOf(res)).at(-1)?.completeness).toBeGreaterThan(0)
    })

    /**
     * A partial frame at the end of one chunk must not be dropped or parsed
     * twice. The buffer carries the remainder across reads.
     */
    it('reassembles a frame split across two chunks', async () => {
      const whole = dataFrame({ type: 'token', delta: 'terpotong' })
      upstream.frames = [
        whole.slice(0, 10),
        whole.slice(10),
        dataFrame({ type: 'done', completeness_score: 10 }),
      ]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect((await framesOf(res)).filter((f) => f.type === 'token').map((f) => f.delta)).toEqual([
        'terpotong',
      ])
    })

    it('ignores frames that are not data lines or will not parse', async () => {
      upstream.frames = [
        ': keep-alive comment\n\n',
        'data: {not json at all}\n\n',
        'data:\n\n',
        dataFrame({ type: 'token', delta: 'tetap jalan' }),
        dataFrame({ type: 'done' }),
      ]

      const res = await stream(session(ownerId), { content: 'Halo' })

      const frames = await framesOf(res)
      expect(frames.filter((f) => f.type === 'token').map((f) => f.delta)).toEqual(['tetap jalan'])
      expect(frames.at(-1)?.type).toBe('done')
    })

    it('ignores an unknown event type without dropping the rest', async () => {
      upstream.frames = [
        dataFrame({ type: 'heartbeat' }),
        dataFrame({ type: 'token', delta: 'lanjut' }),
        dataFrame({ type: 'done' }),
      ]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect((await framesOf(res)).at(-1)?.message).toBe('lanjut')
    })
  })

  describe('failures reported inside the stream', () => {
    /**
     * The status line is already committed, so an upstream failure has to be
     * a frame. What must NOT travel with it is the upstream body: it is there
     * for the logs, and emitting it pushes internal detail to the browser.
     */
    it('reports an upstream failure without leaking its detail', async () => {
      upstream.status = 500

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect(res.status).toBe(200)
      const frames = await framesOf(res)
      const error = frames.find((f) => f.type === 'error')
      expect(error).toBeDefined()
      expect(JSON.stringify(frames)).not.toContain('gemini quota exhausted')
    })

    it('does not persist an AI message when the upstream failed', async () => {
      upstream.status = 500

      await stream(session(ownerId), { content: 'Halo' })

      expect(await aiMessages()).toEqual([])
    })

    /** An error frame from the model, rather than a transport failure. */
    it('passes a model-reported error through as an error frame', async () => {
      upstream.frames = [dataFrame({ type: 'error', message: 'context length exceeded' })]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect(await framesOf(res)).toContainEqual({
        type: 'error',
        message: 'context length exceeded',
      })
    })

    it('names an error frame that carries no message', async () => {
      upstream.frames = [dataFrame({ type: 'error' })]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect(await framesOf(res)).toContainEqual({ type: 'error', message: 'upstream error' })
    })

    /** A 2xx with nothing readable behind it. */
    it('reports a 200 that carries no body', async () => {
      upstream.frames = null

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect(await framesOf(res)).toContainEqual({
        type: 'error',
        message: 'AI service returned no content',
      })
    })

    /**
     * A stream that completed cleanly and produced nothing is still a failure
     * for the owner, and it is a different one from an upstream error - so it
     * is only reported when nothing else already failed.
     */
    it('reports a stream that produced no text at all', async () => {
      upstream.frames = [dataFrame({ type: 'done' })]

      const res = await stream(session(ownerId), { content: 'Halo' })

      expect(await framesOf(res)).toContainEqual({
        type: 'error',
        message: 'AI service returned empty content',
      })
    })

    it('does not add an empty-content error on top of an upstream error', async () => {
      upstream.frames = [dataFrame({ type: 'error', message: 'model exploded' })]

      const res = await stream(session(ownerId), { content: 'Halo' })

      const errors = (await framesOf(res)).filter((f) => f.type === 'error')
      expect(errors).toHaveLength(1)
    })

    /**
     * The tokens are already on the owner's screen when the insert fails, so
     * the reply still has to be delivered - what must not happen is a silent
     * success that leaves the thread missing a turn.
     */
    it('still delivers the reply when it cannot be persisted', async () => {
      const db = getDb()
      const realInsert = db.insert.bind(db)
      let messageInserts = 0
      // Matched on the table, not on a call counter: the route also inserts a
      // chat_conversations row on the way in, so counting every insert failed
      // the owner's own turn before the stream had opened at all.
      vi.spyOn(db, 'insert').mockImplementation(((table: never) => {
        if (table === (chatMessages as never)) {
          messageInserts += 1
          // 1 is the owner's turn, 2 is the AI reply under test.
          if (messageInserts === 2) throw new Error('deadlock detected')
        }
        return realInsert(table)
      }) as never)

      const res = await stream(session(ownerId), { content: 'Halo' })

      const frames = await framesOf(res)
      expect(frames).toContainEqual({ type: 'error', message: 'deadlock detected' })
      // The answer is still handed over rather than silently lost.
      expect(frames.at(-1)).toMatchObject({ type: 'done', message: 'Siapa target penggunanya?' })
      expect(await aiMessages()).toEqual([])
    })
  })
})
