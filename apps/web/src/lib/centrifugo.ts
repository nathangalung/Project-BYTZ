import { Centrifuge } from 'centrifuge'

type CentrifugeClient = InstanceType<typeof Centrifuge>

let client: CentrifugeClient | null = null

export function getCentrifugoClient(): CentrifugeClient {
  if (client) return client

  const url = import.meta.env.VITE_CENTRIFUGO_URL ?? 'ws://localhost:8000/connection/websocket'

  client = new Centrifuge(url, {
    getToken: async () => {
      const res = await fetch('/api/v1/notifications/ws-token', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to get WS token')
      const data = (await res.json()) as { data?: { token?: string } }
      return data.data?.token ?? ''
    },
  })

  client.on('error', (ctx) => {
    console.error('[Centrifugo] Error:', ctx.error)
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
  const sub = c.newSubscription(channel)

  sub.on('publication', (ctx) => {
    onMessage(ctx.data)
  })

  sub.subscribe()

  return () => {
    sub.unsubscribe()
    sub.removeAllListeners()
  }
}
