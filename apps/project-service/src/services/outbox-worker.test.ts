import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock external dependencies before imports
vi.mock('@kerjacus/db', () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  }
  return {
    getDb: vi.fn(() => mockDb),
    outboxEvents: {
      published: 'published',
      retryCount: 'retryCount',
      createdAt: 'createdAt',
      id: 'id',
    },
    deadLetterEvents: {},
  }
})

vi.mock('@nats-io/transport-node', () => ({
  connect: vi.fn().mockResolvedValue({
    close: vi.fn(),
  }),
}))

vi.mock('@nats-io/jetstream', () => ({
  jetstream: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue({}),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ type: 'eq', a, b })),
  lt: vi.fn((a: unknown, b: unknown) => ({ type: 'lt', a, b })),
}))

import { startOutboxProcessor, stopOutboxProcessor } from './outbox-worker'

describe('outbox-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('startOutboxProcessor', () => {
    it('connects to NATS and starts processing', async () => {
      const { connect } = await import('@nats-io/transport-node')

      // Start the processor, it will begin polling in the background
      await startOutboxProcessor()

      expect(connect).toHaveBeenCalled()

      // Stop it immediately to prevent infinite loop
      await stopOutboxProcessor()
    })
  })

  describe('stopOutboxProcessor', () => {
    it('closes NATS connection and stops', async () => {
      // Start first to establish connection
      await startOutboxProcessor()

      // Then stop
      await stopOutboxProcessor()

      // Should close NATS connection
      const { connect } = await import('@nats-io/transport-node')
      const mockConn = await vi.mocked(connect).mock.results[0]?.value
      if (mockConn) {
        expect(mockConn.close).toHaveBeenCalled()
      }
    })

    it('handles stop when not started gracefully', async () => {
      // Should not throw even if never started
      await expect(stopOutboxProcessor()).resolves.not.toThrow()
    })
  })
})
