import { Centrifuge } from 'centrifuge'
import { apiUrl } from './api'

type CentrifugeClient = InstanceType<typeof Centrifuge>

let client: CentrifugeClient | null = null

export function getCentrifugoClient(): CentrifugeClient {
  if (client) return client

  const url = import.meta.env.VITE_CENTRIFUGO_URL ?? 'ws://localhost:8000/connection/websocket'

  client = new Centrifuge(url, {
    maxReconnectDelay: 20000,
    getToken: async () => {
      try {
        const res = await fetch(apiUrl('/api/v1/notifications/ws-token'), {
          credentials: 'include',
        })
        if (!res.ok) return ''
        const data = (await res.json()) as { data?: { token?: string } }
        return data.data?.token ?? ''
      } catch {
        return ''
      }
    },
  })

  let failCount = 0
  client.on('error', (ctx) => {
    failCount++
    if (failCount >= 3) {
      client?.disconnect()
      client = null
      return
    }
    console.warn('[Centrifugo] Connection error (real-time notifications unavailable):', ctx.error)
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

export function subscribeTo(channel: string, onMessage: (data: unknown) => void): () => void {
  const c = getCentrifugoClient()

  // Remove stale subscription from prior mount cycle (React StrictMode: effect
  // runs → cleanup → runs again; without removeSubscription the channel stays
  // in Centrifuge's internal map and newSubscription throws "already exists").
  const existing = c.getSubscription(channel)
  if (existing) {
    existing.unsubscribe()
    existing.removeAllListeners()
    c.removeSubscription(existing)
  }

  const sub = c.newSubscription(channel)
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
