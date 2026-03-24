import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

// Mock @kerjacus/db before importing the route
vi.mock('@kerjacus/db', () => ({
  getDb: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  })),
}))

import { healthRoute } from './health'

function createApp() {
  const app = new Hono()
  app.route('/health', healthRoute)
  return app
}

describe('health route', () => {
  describe('GET /health', () => {
    it('returns ok status with service name', async () => {
      const app = createApp()
      const res = await app.request('/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.service).toBe('auth-service')
    })

    it('includes uptime in seconds', async () => {
      const app = createApp()
      const res = await app.request('/health')

      const body = (await res.json()) as Record<string, unknown>
      expect(typeof body.uptime).toBe('number')
      expect(body.uptime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('GET /health/ready', () => {
    it('returns ready when database is connected', async () => {
      const app = createApp()
      const res = await app.request('/health/ready')

      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('ready')
    })

    it('returns 503 when database connection fails', async () => {
      const { getDb } = await import('@kerjacus/db')
      vi.mocked(getDb).mockReturnValueOnce({
        execute: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as never)

      const app = createApp()
      const res = await app.request('/health/ready')

      expect(res.status).toBe(503)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('not_ready')
      expect(body.reason).toBe('database connection failed')
    })
  })
})
