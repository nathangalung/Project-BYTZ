import { describe, expect, it, vi } from 'vitest'

/**
 * index.ts imports this for its side effect, before anything else. The service
 * name it registers is the field every span is grouped by in OpenObserve, so a
 * wrong one buries this service's traces under another's.
 */

const initTracing = vi.fn()

vi.mock('@kerjacus/logger', () => ({ initTracing }))

describe('tracing bootstrap', () => {
  it('registers this service by name, once, on import', async () => {
    await import('./otel')

    expect(initTracing).toHaveBeenCalledTimes(1)
    expect(initTracing).toHaveBeenCalledWith('auth-service')
  })
})
