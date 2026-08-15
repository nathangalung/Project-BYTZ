import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The opt-out and the singleton, which are the two branches a caller controls.
 *
 * Everything past them constructs a NodeSDK, opens OTLP exporters and registers
 * SIGTERM and SIGINT handlers that call process.exit. Driving that in-process
 * would install signal handlers into the test runner and start a 30 second
 * metric reader, so it stays uncovered deliberately rather than mocked into a
 * shape that proves nothing about the real bootstrap. The Go services carry the
 * equivalent wiring and it is covered there, in observability_test.go, where
 * the SDK is cheap to stand up.
 *
 * The shutdown handler stays uncovered for a harder reason than cost: it ends
 * in process.exit(0), so executing it terminates the test runner mid-suite.
 * The SIGTERM and SIGINT registration around it is one line of wiring guarding
 * a call that cannot be allowed to run here.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('initTracing', () => {
  it('returns null when tracing is switched off', async () => {
    vi.stubEnv('OTEL_DISABLED', 'true')
    const { initTracing } = await import('./tracing')

    expect(initTracing('project-service')).toBeNull()
  })

  /** Only the exact string disables it; anything else means run. */
  it('treats any other value as enabled', async () => {
    vi.stubEnv('OTEL_DISABLED', 'false')
    const { initTracing } = await import('./tracing')

    // Not null, so it went on to build the SDK rather than taking the opt-out.
    expect(initTracing('svc')).not.toBeNull()
  })

  /**
   * The module holds one SDK. A second call has to hand back the first rather
   * than starting a parallel exporter against the same endpoint.
   */
  it('returns the same instance on a second call', async () => {
    const { initTracing } = await import('./tracing')

    const first = initTracing('svc')
    const second = initTracing('svc-again')

    expect(second).toBe(first)
  })

  /**
   * A failed SDK start must not take the service down with it.
   *
   * The whole point of returning null is that telemetry is optional: an
   * unreachable collector degrades to no traces rather than to no service.
   * Mocking the SDK rather than this module means the real initTracing runs.
   */
  it('returns null instead of throwing when the SDK will not start', async () => {
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        start() {
          throw new Error('collector unreachable')
        }
        shutdown() {
          return Promise.resolve()
        }
      },
    }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { initTracing } = await import('./tracing')

    expect(initTracing('project-service')).toBeNull()
    expect(error).toHaveBeenCalled()

    error.mockRestore()
    vi.doUnmock('@opentelemetry/sdk-node')
  })
})
