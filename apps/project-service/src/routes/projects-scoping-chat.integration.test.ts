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
 * The scoping chat, which is the owner's whole path from an intake form to a
 * BRD, and the two bounds that stop one turn costing the platform arbitrarily.
 *
 * Every turn used to load the entire conversation and ship it upstream, so
 * cost and latency grew with the square of the session, and the owner's
 * message was checked only for being non-empty. max_output_tokens is capped on
 * the AI side, which left the input as the last unbounded dimension. Both
 * bounds are asserted here against a real conversation because the window is a
 * `.limit()` with a `desc` order and a `.reverse()`, and getting that wrong
 * silently sends the OLDEST forty turns - the tail is what the next answer
 * depends on, so the mistake reads as the model losing the thread rather than
 * as a bug.
 *
 * The other property worth pinning is that a project has exactly one scoping
 * thread. Three routes used to write their own find-or-create, all
 * check-then-act; two concurrent sends both saw no row and both inserted, and
 * the project ended up with two threads holding half the history each. Nothing
 * failed loudly, because the readers take `.limit(1)` with no ORDER BY, so
 * Postgres hands back whichever half it likes and the BRD is generated from
 * that one.
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
type ChatBody = {
  success: true
  data: { message: string; completeness: number; missing: string[]; suggestGenerateBrd: boolean }
}
type AiRequest = { messages: { role: string; content: string }[]; project_id: string }

runIf('scoping chat against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let strangerId: string
  let projectId: string

  let aiStatus: number
  let aiBody: unknown
  let aiCalls: AiRequest[]

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
    aiBody = { message: { content: 'Siapa target penggunanya?' }, completeness_score: 40 }
    resetServicePolicies()

    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      aiCalls.push(JSON.parse(String(init?.body ?? '{}')) as AiRequest)
      if (aiStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'model overloaded' } }), {
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
    projectId = await makeProject()
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

  async function makeProject(preferences: unknown = null): Promise<string> {
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
      preferences,
    })
    return id
  }

  function chat(caller: SessionUser | null, body: unknown, project = projectId) {
    return app(caller).request(`/${project}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function conversations() {
    return await handle.db
      .select({ id: chatConversations.id, type: chatConversations.type })
      .from(chatConversations)
      .where(eq(chatConversations.projectId, projectId))
  }

  async function messages(conversationId: string) {
    return await handle.db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(chatMessages.createdAt)
  }

  describe('POST /:id/chat', () => {
    it('records the turn, calls the model and stores the reply', async () => {
      const res = await chat(session(ownerId), { content: 'Saya butuh marketplace jasa' })

      expect(res.status).toBe(200)
      expect((await res.json()) as ChatBody).toMatchObject({
        data: { message: 'Siapa target penggunanya?', suggestGenerateBrd: false },
      })
      const [conversation] = await conversations()
      expect(conversation.type).toBe('ai_scoping')
      expect(await messages(conversation.id)).toEqual([
        { senderType: 'user', content: 'Saya butuh marketplace jasa' },
        { senderType: 'ai', content: 'Siapa target penggunanya?' },
      ])
    })

    it('refuses a caller who does not own the project', async () => {
      const res = await chat(session(strangerId), { content: 'Halo' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(aiCalls).toHaveLength(0)
      expect(await conversations()).toHaveLength(0)
    })

    it('reports a project that does not exist', async () => {
      const res = await chat(session(ownerId), { content: 'Halo' }, uuidv7())

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND')
    })

    it.each([
      ['an empty message', ''],
      ['whitespace only', '   \n\t '],
    ])('rejects %s', async (_label, content) => {
      const res = await chat(session(ownerId), { content })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('required')
      expect(aiCalls).toHaveLength(0)
    })

    it('rejects a message with no content field at all', async () => {
      const res = await chat(session(ownerId), {})

      expect(res.status).toBe(400)
      expect(aiCalls).toHaveLength(0)
    })

    /**
     * The last unbounded input dimension. Without this an owner can paste a
     * novel into one turn and the platform pays for the tokens.
     */
    it('rejects a message past the length bound', async () => {
      const res = await chat(session(ownerId), {
        content: 'x'.repeat(MAX_SCOPING_MESSAGE_LENGTH + 1),
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('too long')
      expect(aiCalls).toHaveLength(0)
    })

    it('accepts a message exactly at the bound', async () => {
      const res = await chat(session(ownerId), { content: 'x'.repeat(MAX_SCOPING_MESSAGE_LENGTH) })

      expect(res.status).toBe(200)
    })

    it('trims the stored message', async () => {
      await chat(session(ownerId), { content: '  butuh marketplace  ' })

      const [conversation] = await conversations()
      expect((await messages(conversation.id))[0].content).toBe('butuh marketplace')
    })

    /**
     * The history window, and the half of it that is easy to get backwards.
     * The query orders newest-first, takes forty and reverses, so the model
     * must receive the NEWEST turns in oldest-first order. Sending the oldest
     * forty instead reads as the model losing the thread, not as a bug.
     */
    it('sends only the newest turns, oldest first, plus the system preamble', async () => {
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

      await chat(session(ownerId), { content: 'turn-latest' })

      const sent = aiCalls[0].messages
      expect(sent[0].role).toBe('system')
      expect(sent).toHaveLength(SCOPING_HISTORY_WINDOW + 1)
      const history = sent.slice(1)
      // Newest window: turns 21..59 plus the message just posted.
      expect(history[0].content).toBe('turn-21')
      expect(history.at(-1)?.content).toBe('turn-latest')
      expect(history.map((m) => m.content)).not.toContain('turn-0')
    })

    it('puts the intake form into the system preamble as ground truth', async () => {
      const withPrefs = await makeProject({
        problem: 'Talenta sulit ditemukan',
        targetUsers: 'UMKM',
        platforms: ['web', 'android'],
      })

      await chat(session(ownerId), { content: 'Lanjut' }, withPrefs)

      const preamble = aiCalls[0].messages[0].content
      expect(preamble).toContain('Project title: Marketplace')
      expect(preamble).toContain('Rp 5.000.000 - Rp 20.000.000')
      expect(preamble).toContain('Problem statement: Talenta sulit ditemukan')
      expect(preamble).toContain('Platforms: web, android')
      // The point of sending it: stop the model re-asking what the form knows.
      expect(preamble).toContain('do NOT re-ask for these fields')
    })

    /**
     * The score is max(form floor, model score). A model that lowballs a
     * well-filled form must not drag the owner's progress backwards.
     */
    it('floors the completeness at what the form already established', async () => {
      const withPrefs = await makeProject({
        problem: 'Talenta sulit ditemukan oleh UMKM di daerah',
        targetUsers: 'UMKM dan startup lokal',
        mainFeatures: 'pencarian talenta, escrow, chat, invoice otomatis',
        industry: 'marketplace jasa digital',
      })
      aiBody = { message: { content: 'Baik' }, completeness_score: 5 }

      const res = await chat(session(ownerId), { content: 'Lanjut' }, withPrefs)

      const body = (await res.json()) as ChatBody
      expect(body.data.completeness).toBeGreaterThan(5)
    })

    it('suggests generating the BRD once the score reaches 80', async () => {
      aiBody = { message: { content: 'Cukup lengkap' }, completeness_score: 80 }

      const res = await chat(session(ownerId), { content: 'Sudah semua' })

      expect(((await res.json()) as ChatBody).data.suggestGenerateBrd).toBe(true)
    })

    /** Both response envelopes the AI service has used are accepted. */
    it('reads the reply out of a data-wrapped envelope', async () => {
      aiBody = {
        data: {
          message: { content: 'Dari envelope data' },
          completeness_score: 55,
          missing: ['success_metrics'],
        },
      }

      const res = await chat(session(ownerId), { content: 'Halo' })

      expect((await res.json()) as ChatBody).toMatchObject({
        data: { message: 'Dari envelope data', completeness: 55, missing: ['success_metrics'] },
      })
    })

    /**
     * An empty reply is a failed turn. Storing it would leave a blank AI
     * message in the thread that BRD generation would later read as context.
     */
    it('refuses an empty reply from the model and stores nothing for it', async () => {
      aiBody = { message: { content: '' }, completeness_score: 10 }

      const res = await chat(session(ownerId), { content: 'Halo' })

      expect(res.status).toBe(502)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AI_INVALID_RESPONSE')
      const [conversation] = await conversations()
      expect((await messages(conversation.id)).filter((m) => m.senderType === 'ai')).toHaveLength(0)
    })

    /**
     * The upstream body used to be sliced into the user-visible message, which
     * leaks internal detail. It must stay in the log and the caller gets the
     * catalog code.
     */
    it('does not leak the upstream failure detail to the caller', async () => {
      aiStatus = 500

      const res = await chat(session(ownerId), { content: 'Halo' })

      expect(res.status).toBe(503)
      const body = (await res.json()) as ErrorBody
      expect(body.error.code).toBe('AI_SERVICE_UNAVAILABLE')
      expect(JSON.stringify(body)).not.toContain('model overloaded')
    })

    /** One thread per project, no matter how many turns are taken. */
    it('reuses the single scoping thread across turns', async () => {
      await chat(session(ownerId), { content: 'Pesan satu' })
      await chat(session(ownerId), { content: 'Pesan dua' })

      const threads = await conversations()
      expect(threads).toHaveLength(1)
      expect(await messages(threads[0].id)).toHaveLength(4)
    })

    /**
     * Two concurrent sends - a double click, or the SSE client retrying. The
     * unique index chat_conversations_scoping_unique is what decides it; a
     * second thread would split the history in half and BRD generation would
     * silently run on whichever half Postgres returned.
     */
    it('never opens a second thread for concurrent sends', async () => {
      await Promise.all([
        chat(session(ownerId), { content: 'Pesan satu' }),
        chat(session(ownerId), { content: 'Pesan dua' }),
      ])

      expect(await conversations()).toHaveLength(1)
    })
  })

  describe('GET /:id/scoping-status', () => {
    function status(caller: SessionUser | null, project = projectId) {
      return app(caller).request(`/${project}/scoping-status`)
    }

    /**
     * The gaps are named so the scoping page can open with a question rather
     * than an empty chat the owner has to guess at.
     */
    it('names what the intake form left out', async () => {
      const res = await status(session(ownerId))

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { formFloor: number; missing: string[]; suggestGenerateBrd: boolean }
      }
      expect(body.data.missing.length).toBeGreaterThan(0)
      expect(body.data.suggestGenerateBrd).toBe(false)
    })

    /**
     * The floor is keyword matching over the concatenated form text, and the
     * keys line up one for one with the AI scorer's checks and the missing_*
     * i18n labels, so the chips, the assistant's opening question and the
     * chat's own score all describe the same gaps. The preferences below are
     * written to hit distinct buckets - problem, objectives, features, users,
     * risks, metrics, integrations - rather than merely to be long.
     */
    it('reports a higher floor and fewer gaps for a fully filled form', async () => {
      const bare = await status(session(ownerId))
      const bareBody = (await bare.json()) as { data: { formFloor: number; missing: string[] } }

      const filled = await makeProject({
        problem: 'Saat ini prosesnya manual dan tidak bisa diukur, itu masalah utama',
        targetUsers: 'pengguna UMKM, admin internal dan pembeli',
        mainFeatures: 'fitur dashboard, halaman login dan register, modul laporan',
        industry: 'sistem marketplace jasa digital yang harus punya data laporan',
        budgetRange: 'anggaran menengah',
        deadlineRange: 'selesai dalam 3 bulan',
        platforms: ['integrasi midtrans', 'notifikasi whatsapp'],
        requiredSkills: [
          'tujuan meningkatkan konversi',
          'metrik sukses diukur',
          'risiko keterbatasan waktu jadi tantangan',
        ],
      })
      const res = await status(session(ownerId), filled)
      const body = (await res.json()) as { data: { formFloor: number; missing: string[] } }

      expect(body.data.formFloor).toBeGreaterThan(bareBody.data.formFloor)
      expect(body.data.missing.length).toBeLessThan(bareBody.data.missing.length)
    })

    it('refuses a caller who does not own the project', async () => {
      const res = await status(session(strangerId))

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports a project that does not exist', async () => {
      const res = await status(session(ownerId), uuidv7())

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND')
    })
  })
})
