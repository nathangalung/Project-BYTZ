import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Before this route existed, chat:, project: and milestone: carried
 * allow_subscribe_for_client and no "#", so any connected client could
 * subscribe to any id. A token is required now, and it is only issued to
 * someone the project or the conversation actually admits.
 */

const SECRET = 'a-test-centrifugo-secret'
let currentUserId = 'user-1'
let participantRows: Array<{ id: string }> = []
let accessError: Error | null = null

vi.mock('../lib/env', () => ({
  env: { CENTRIFUGO_SECRET: SECRET },
}))

vi.mock('../middleware/session', () => ({
  getAuthUser: () => ({ id: currentUserId }),
}))

vi.mock('../lib/project-access', () => ({
  assertProjectAccess: async () => {
    if (accessError) throw accessError
  },
}))

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => participantRows }) }) }),
  }),
}))

const { Hono } = await import('hono')
const { realtimeRoute } = await import('./realtime')
const { errorHandler } = await import('../middleware/error-handler')
const { AppError } = await import('@kerjacus/shared')

const app = new Hono().route('/realtime', realtimeRoute)
app.onError(errorHandler)

beforeEach(() => {
  currentUserId = 'user-1'
  participantRows = [{ id: 'participant-1' }]
  accessError = null
})

function token(channel: string) {
  return app.request(`/realtime/subscription-token?channel=${encodeURIComponent(channel)}`)
}

describe('project and milestone channels', () => {
  it('issues a token to someone on the project', async () => {
    const res = await token('project:p-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { token: string } }
    expect(body.data.token.split('.')).toHaveLength(3)
  })

  it('refuses someone who is not on the project', async () => {
    accessError = new AppError('AUTH_FORBIDDEN', 'Not authorized')
    expect((await token('project:p-1')).status).toBe(403)
  })

  // milestone: is keyed by project id, so it takes the same check.
  it('applies the same check to milestone', async () => {
    accessError = new AppError('AUTH_FORBIDDEN', 'Not authorized')
    expect((await token('milestone:p-1')).status).toBe(403)
  })
})

describe('chat channels', () => {
  it('issues a token to a participant', async () => {
    expect((await token('chat:c-1')).status).toBe(200)
  })

  // 168 hours of someone else's messages replay on subscribe.
  it('refuses a non-participant', async () => {
    participantRows = []
    expect((await token('chat:c-1')).status).toBe(403)
  })
})

describe('channels it will not sign', () => {
  it.each(['notifications#user-2', 'anything:x', 'project', 'project:', 'project:a:b'])(
    'refuses %s',
    async (channel) => {
      expect((await token(channel)).status).toBe(403)
    },
  )

  // Would let a caller forge a user-limited channel name.
  it('refuses an id containing the user separator', async () => {
    expect((await token('project:p-1#user-2')).status).toBe(403)
  })

  it('requires a channel at all', async () => {
    expect((await app.request('/realtime/subscription-token')).status).toBe(400)
  })
})

describe('the token names the caller', () => {
  it('signs the session user, not anything from the query', async () => {
    currentUserId = 'user-9'
    const res = await token('project:p-1')
    const body = (await res.json()) as { data: { token: string } }
    const claims = JSON.parse(
      Buffer.from(body.data.token.split('.')[1], 'base64url').toString('utf8'),
    )
    expect(claims.sub).toBe('user-9')
    expect(claims.channel).toBe('project:p-1')
  })
})
