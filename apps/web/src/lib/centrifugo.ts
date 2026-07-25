import { Centrifuge, UnauthorizedError } from 'centrifuge'
import { apiUrl } from './api'

type CentrifugeClient = InstanceType<typeof Centrifuge>

let client: CentrifugeClient | null = null

/**
 * Fetch a token, telling the client apart from a dead session and a bad day.
 *
 * Returning an empty string reads to Centrifuge as a token, so it kept
 * retrying a signed-out session forever. UnauthorizedError is the documented
 * way to say stop; anything else is transient and the client should back off
 * and try again on its own.
 */
async function fetchToken(path: string): Promise<string> {
  const res = await fetch(apiUrl(path), { credentials: 'include' })
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedError('not authorized for real-time updates')
  }
  if (!res.ok) throw new Error(`token endpoint ${res.status}`)
  const data = (await res.json()) as { data?: { token?: string } }
  const token = data.data?.token
  if (!token) throw new Error('token endpoint returned no token')
  return token
}

export function getCentrifugoClient(): CentrifugeClient {
  if (client) return client

  const url = import.meta.env.VITE_CENTRIFUGO_URL ?? 'ws://localhost:8000/connection/websocket'

  client = new Centrifuge(url, {
    minReconnectDelay: 500,
    maxReconnectDelay: 20000,
    getToken: () => fetchToken('/api/v1/notifications/ws-token'),
  })

  // Informational only. Tearing the client down here is what broke chat: a
  // few transport errors nulled the singleton, every open subscription died
  // with it, and nothing reconnected until a full page reload.
  client.on('error', (ctx) => {
    console.warn('[Centrifugo] transport error, retrying:', ctx.error)
  })

  return client
}

export function connectCentrifugo(): void {
  const c = getCentrifugoClient()
  c.connect()
}

export function disconnectCentrifugo(): void {
  if (client) {
    client.disconnect()
    client = null
  }
}

/**
 * Fetch a subscription token for one channel.
 *
 * chat, project and milestone no longer accept a bare subscribe: project
 * service checks the caller against the assignment or participant rows and
 * signs a short-lived token naming this channel and this user. Channels
 * carrying "#", which is only notifications, are enforced by Centrifugo
 * against the connection token and need none of this.
 */
async function fetchSubscriptionToken(channel: string): Promise<string> {
  return await fetchToken(
    `/api/v1/realtime/subscription-token?channel=${encodeURIComponent(channel)}`,
  )
}

export function subscribeTo(channel: string, onMessage: (data: unknown) => void): () => void {
  const c = getCentrifugoClient()

  // The constructor does not open the socket, and connectCentrifugo only ran
  // inside useNotifications - mounted on two pages, neither of them Messages.
  // Every other subscriber was publishing into a socket nobody had opened and
  // silently falling back to polling. connect() is a no-op once connected.
  c.connect()

  // Remove stale subscription from prior mount cycle (React StrictMode: effect
  // runs → cleanup → runs again; without removeSubscription the channel stays
  // in Centrifuge's internal map and newSubscription throws "already exists").
  const existing = c.getSubscription(channel)
  if (existing) {
    existing.unsubscribe()
    existing.removeAllListeners()
    c.removeSubscription(existing)
  }

  const sub = channel.includes('#')
    ? c.newSubscription(channel)
    : c.newSubscription(channel, { getToken: () => fetchSubscriptionToken(channel) })
  sub.on('publication', (ctx) => {
    onMessage(ctx.data)
  })
  sub.subscribe()

  return () => {
    sub.unsubscribe()
    sub.removeAllListeners()
    c.removeSubscription(sub)
  }
}
