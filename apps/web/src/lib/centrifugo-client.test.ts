import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the module rather than reading it. centrifugo.test.ts asserts on
 * the source text, which pins the shape of the fix but cannot tell whether a
 * 403 actually produces an UnauthorizedError or whether the cleanup really
 * removes the subscription.
 *
 * The centrifuge package is replaced with a fake that records what the module
 * asked it to do and hands back the option objects, so the getToken callbacks
 * can be invoked directly.
 */

class FakeSubscription {
  handlers = new Map<string, (ctx: unknown) => void>()
  subscribed = false
  unsubscribed = false
  listenersRemoved = false

  constructor(
    readonly channel: string,
    readonly options?: { getToken?: () => Promise<string> },
  ) {}

  on(event: string, handler: (ctx: unknown) => void) {
    this.handlers.set(event, handler)
  }
  subscribe() {
    this.subscribed = true
  }
  unsubscribe() {
    this.unsubscribed = true
  }
  removeAllListeners() {
    this.listenersRemoved = true
  }
}

class FakeCentrifuge {
  static instances: FakeCentrifuge[] = []
  subscriptions = new Map<string, FakeSubscription>()
  removed: FakeSubscription[] = []
  connectCount = 0
  disconnectCount = 0
  handlers = new Map<string, (ctx: unknown) => void>()

  constructor(
    readonly url: string,
    readonly options: { getToken?: () => Promise<string> },
  ) {
    FakeCentrifuge.instances.push(this)
  }

  on(event: string, handler: (ctx: unknown) => void) {
    this.handlers.set(event, handler)
  }
  connect() {
    this.connectCount += 1
  }
  disconnect() {
    this.disconnectCount += 1
  }
  getSubscription(channel: string) {
    return this.subscriptions.get(channel) ?? null
  }
  newSubscription(channel: string, options?: { getToken?: () => Promise<string> }) {
    const sub = new FakeSubscription(channel, options)
    this.subscriptions.set(channel, sub)
    return sub
  }
  removeSubscription(sub: FakeSubscription) {
    this.removed.push(sub)
    this.subscriptions.delete(sub.channel)
  }
}

class FakeUnauthorizedError extends Error {
  name = 'UnauthorizedError'
}

vi.mock('centrifuge', () => ({
  Centrifuge: FakeCentrifuge,
  UnauthorizedError: FakeUnauthorizedError,
}))

const { connectCentrifugo, disconnectCentrifugo, getCentrifugoClient, subscribeTo } = await import(
  './centrifugo'
)

function stubFetch(impl: (url: string) => Promise<Response>) {
  const spy = vi.fn(impl)
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

function tokenBody(token: unknown, status = 200) {
  return new Response(JSON.stringify({ data: { token } }), { status })
}

/** Reach the connection-level getToken the module handed the constructor. */
function connectionGetToken() {
  getCentrifugoClient()
  const client = FakeCentrifuge.instances.at(-1)
  if (!client?.options.getToken) throw new Error('client was built without a getToken')
  return client.options.getToken
}

beforeEach(() => {
  FakeCentrifuge.instances = []
  vi.clearAllMocks()
  // Every test starts without a client, since the module holds a singleton.
  disconnectCentrifugo()
  FakeCentrifuge.instances = []
  stubFetch(async () => tokenBody('tok'))
})

describe('the client singleton', () => {
  it('builds one client and reuses it', () => {
    const first = getCentrifugoClient()
    const second = getCentrifugoClient()

    expect(first).toBe(second)
    expect(FakeCentrifuge.instances).toHaveLength(1)
  })

  it('opens the socket on connect', () => {
    connectCentrifugo()

    expect(FakeCentrifuge.instances[0].connectCount).toBe(1)
  })

  /**
   * Sign-out has to drop the singleton, not just close it: the next user's
   * client must be built fresh so it fetches a token for their session.
   */
  it('drops the singleton on disconnect so the next user gets a new client', () => {
    const first = getCentrifugoClient()

    disconnectCentrifugo()
    const second = getCentrifugoClient()

    expect(first).not.toBe(second)
    expect((first as unknown as FakeCentrifuge).disconnectCount).toBe(1)
    expect(FakeCentrifuge.instances).toHaveLength(2)
  })

  it('disconnecting when nothing is connected is a no-op', () => {
    disconnectCentrifugo()

    expect(FakeCentrifuge.instances).toHaveLength(0)
  })

  /**
   * A few transport errors used to null the singleton, killing every open
   * subscription with it and leaving the tab with no realtime until reload.
   */
  it('keeps the client alive through a transport error', () => {
    const client = getCentrifugoClient() as unknown as FakeCentrifuge
    const onError = client.handlers.get('error')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    onError?.({ error: { code: 5, message: 'connect timeout' } })

    expect(getCentrifugoClient()).toBe(client)
    expect(client.disconnectCount).toBe(0)
  })
})

/**
 * Returning an empty string reads to the client as a token, so it retried a
 * dead session forever. UnauthorizedError is the documented way to say stop;
 * anything else is transient and the client should back off on its own.
 */
describe('fetching the connection token', () => {
  it('returns the token the endpoint issued', async () => {
    stubFetch(async () => tokenBody('a-real-token'))

    await expect(connectionGetToken()()).resolves.toBe('a-real-token')
  })

  it('asks the notification service for it with the session cookie', async () => {
    const spy = stubFetch(async () => tokenBody('tok'))

    await connectionGetToken()()

    expect(String(spy.mock.calls[0][0])).toContain('/api/v1/notifications/ws-token')
  })

  it.each([401, 403])('stops retrying on %i', async (status) => {
    stubFetch(async () => tokenBody(null, status))

    await expect(connectionGetToken()()).rejects.toBeInstanceOf(FakeUnauthorizedError)
  })

  /** A 500 is transient, so it must not read as a dead session. */
  it('reports a server failure as an ordinary error', async () => {
    stubFetch(async () => tokenBody(null, 500))

    const err = await connectionGetToken()().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(FakeUnauthorizedError)
  })

  it('refuses a 200 that carries no token', async () => {
    stubFetch(async () => tokenBody(undefined))

    await expect(connectionGetToken()()).rejects.toThrow(/no token/)
  })
})

describe('subscribing to a channel', () => {
  it('opens the connection, since the constructor does not', () => {
    subscribeTo('chat:c1', () => {})

    expect(FakeCentrifuge.instances[0].connectCount).toBeGreaterThanOrEqual(1)
  })

  it('delivers a publication to the caller', () => {
    const onMessage = vi.fn()
    subscribeTo('chat:c1', onMessage)
    const sub = FakeCentrifuge.instances[0].subscriptions.get('chat:c1')

    sub?.handlers.get('publication')?.({ data: { id: 'm1' } })

    expect(onMessage).toHaveBeenCalledWith({ id: 'm1' })
    expect(sub?.subscribed).toBe(true)
  })

  /**
   * StrictMode runs the effect, cleans up, then runs it again. Without
   * removing the stale entry first, centrifuge throws "already exists" on the
   * second run and the channel is left dead.
   */
  it('replaces a subscription left behind by a previous mount', () => {
    subscribeTo('chat:c1', () => {})
    const first = FakeCentrifuge.instances[0].subscriptions.get('chat:c1')

    subscribeTo('chat:c1', () => {})

    expect(first?.unsubscribed).toBe(true)
    expect(first?.listenersRemoved).toBe(true)
    expect(FakeCentrifuge.instances[0].removed).toContain(first)
  })

  it('the returned cleanup tears the subscription down completely', () => {
    const unsubscribe = subscribeTo('chat:c1', () => {})
    const sub = FakeCentrifuge.instances[0].subscriptions.get('chat:c1')

    unsubscribe()

    expect(sub?.unsubscribed).toBe(true)
    expect(sub?.listenersRemoved).toBe(true)
    expect(FakeCentrifuge.instances[0].removed).toContain(sub)
  })

  /**
   * Project service checks the caller against the assignment or participant
   * rows before signing a channel token. A '#' channel is enforced by
   * Centrifugo against the connection token instead and needs none of this.
   */
  it('signs a private channel with its own subscription token', async () => {
    const spy = stubFetch(async () => tokenBody('sub-token'))
    subscribeTo('chat:c1', () => {})
    const sub = FakeCentrifuge.instances[0].subscriptions.get('chat:c1')

    await expect(sub?.options?.getToken?.()).resolves.toBe('sub-token')
    const url = String(spy.mock.calls.at(-1)?.[0])
    expect(url).toContain('/api/v1/realtime/subscription-token')
    expect(url).toContain('channel=chat%3Ac1')
  })

  it('asks for no subscription token on a user channel', () => {
    subscribeTo('notifications#u1', () => {})
    const sub = FakeCentrifuge.instances[0].subscriptions.get('notifications#u1')

    expect(sub?.options).toBeUndefined()
  })

  it('escapes the channel name into the query string', async () => {
    const spy = stubFetch(async () => tokenBody('sub-token'))
    subscribeTo('project:p 1&x', () => {})
    const sub = FakeCentrifuge.instances[0].subscriptions.get('project:p 1&x')

    await sub?.options?.getToken?.()

    expect(String(spy.mock.calls.at(-1)?.[0])).toContain('channel=project%3Ap%201%26x')
  })
})
