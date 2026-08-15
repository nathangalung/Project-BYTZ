import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetServicePolicies } from '../resilience'
import { serviceFetch } from './service-fetch'
import { UpstreamError } from './upstream-error'

const realFetch = globalThis.fetch

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function fail(status: number, message = 'upstream detail'): Response {
  return new Response(JSON.stringify({ error: { message } }), { status })
}

beforeEach(() => {
  // Circuits are process-wide; without this a tripped breaker leaks between tests.
  resetServicePolicies()
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('serviceFetch', () => {
  it('attaches inter-service auth so the downstream does not answer 401', async () => {
    const spy = vi.fn(async (_url: string, _init: RequestInit) => ok())
    globalThis.fetch = spy as unknown as typeof fetch

    await serviceFetch('http://svc/x', {}, { service: 'ai-service', timeoutMs: 1000 })

    const init = spy.mock.calls[0][1]
    expect((init.headers as Record<string, string>)['X-Service-Auth']).toBeDefined()
  })

  it('applies a deadline so a hung downstream cannot pin the caller forever', async () => {
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch

    await expect(
      serviceFetch('http://svc/x', {}, { service: 'ai-service', timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(UpstreamError)
  })

  it('reports a non-2xx as UpstreamError carrying the status', async () => {
    globalThis.fetch = (async () => fail(500)) as unknown as typeof fetch

    const err = await serviceFetch(
      'http://svc/x',
      {},
      { service: 'payment-service', timeoutMs: 1000 },
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).status).toBe(500)
    expect((err as UpstreamError).detail).toBe('upstream detail')
  })

  /**
   * The old policy used handleAll, so a deterministic 400 burned three attempts
   * and about eleven seconds before failing. A 4xx is a bug in our request.
   */
  it('does not retry a 4xx even when retries are enabled', async () => {
    const spy = vi.fn(async () => fail(400))
    globalThis.fetch = spy as unknown as typeof fetch

    await expect(
      serviceFetch(
        'http://svc/x',
        {},
        { service: 'payment-service', timeoutMs: 1000, retryTransient: true },
      ),
    ).rejects.toBeInstanceOf(UpstreamError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx when the caller opted in, and replays the body', async () => {
    let attempt = 0
    const spy = vi.fn(async (_url: string, _init: RequestInit) => {
      attempt += 1
      return attempt < 3 ? fail(503) : ok({ done: true })
    })
    globalThis.fetch = spy as unknown as typeof fetch

    const res = await serviceFetch(
      'http://svc/x',
      { method: 'POST', body: JSON.stringify({ a: 1 }) },
      { service: 'payment-service', timeoutMs: 1000, retryTransient: true },
    )

    expect(await res.json()).toEqual({ done: true })
    expect(spy).toHaveBeenCalledTimes(3)
    // Every attempt must carry the same body, or a replay would post nothing.
    for (const call of spy.mock.calls) {
      expect(call[1].body).toBe(JSON.stringify({ a: 1 }))
    }
  })

  it('does not retry when the caller did not opt in', async () => {
    const spy = vi.fn(async () => fail(503))
    globalThis.fetch = spy as unknown as typeof fetch

    await expect(
      serviceFetch('http://svc/x', {}, { service: 'ai-service', timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(UpstreamError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('gives each downstream its own circuit', async () => {
    globalThis.fetch = (async () => fail(500)) as unknown as typeof fetch

    // Trip ai-service: ConsecutiveBreaker(5).
    for (let i = 0; i < 6; i += 1) {
      await serviceFetch('http://ai/x', {}, { service: 'ai-service', timeoutMs: 1000 }).catch(
        () => undefined,
      )
    }

    const spy = vi.fn(async () => ok({ fine: true }))
    globalThis.fetch = spy as unknown as typeof fetch

    // payment-service must be unaffected by ai-service's open circuit.
    const res = await serviceFetch(
      'http://pay/x',
      {},
      { service: 'payment-service', timeoutMs: 1000 },
    )
    expect(await res.json()).toEqual({ fine: true })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reports an open circuit as a transport-level UpstreamError', async () => {
    globalThis.fetch = (async () => fail(500)) as unknown as typeof fetch
    for (let i = 0; i < 6; i += 1) {
      await serviceFetch('http://ai/x', {}, { service: 'ai-service', timeoutMs: 1000 }).catch(
        () => undefined,
      )
    }

    const err = await serviceFetch(
      'http://ai/x',
      {},
      { service: 'ai-service', timeoutMs: 1000 },
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).status).toBeNull()
    expect((err as UpstreamError).detail).toBe('circuit open')
  })

  /**
   * An owner navigating away from a streaming chat is normal traffic, not an
   * upstream fault, so it must not count toward the breaker.
   */
  it('propagates caller cancellation without wrapping it as an upstream fault', async () => {
    const controller = new AbortController()
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('caller aborted')))
      })) as unknown as typeof fetch

    const promise = serviceFetch(
      'http://svc/x',
      {},
      { service: 'ai-service', timeoutMs: 5000, signal: controller.signal },
    )
    controller.abort()

    await expect(promise).rejects.not.toBeInstanceOf(UpstreamError)
  })

  /**
   * Detail is what document-generation.ts turns into the operator-facing
   * reason. A downstream that answers JSON without the envelope leaves it
   * undefined, and the empty-string fallback is what stops "undefined"
   * reaching an owner-visible message.
   */
  it('reports empty detail when the error body carries no message', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: 'not our envelope' }), {
        status: 500,
      })) as unknown as typeof fetch

    const err = await serviceFetch(
      'http://svc/x',
      {},
      { service: 'payment-service', timeoutMs: 1000 },
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).detail).toBe('')
  })

  /**
   * fetch rejects with an Error in every runtime we ship on, but the reason
   * string is built before anything narrows the cause. A non-Error rejection
   * would otherwise interpolate as "undefined" into the breaker's detail.
   */
  it('names a non-Error transport rejection rather than interpolating undefined', async () => {
    globalThis.fetch = (() => Promise.reject('socket hang up')) as unknown as typeof fetch

    const err = await serviceFetch(
      'http://svc/x',
      {},
      { service: 'ai-service', timeoutMs: 1000 },
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).status).toBeNull()
    expect((err as UpstreamError).detail).toBe('transport failure')
  })
})

describe('UpstreamError', () => {
  it('treats transport failures, 429 and 5xx as retryable and 4xx as not', () => {
    expect(new UpstreamError('ai-service', null, '').retryable).toBe(true)
    expect(new UpstreamError('ai-service', 429, '').retryable).toBe(true)
    expect(new UpstreamError('ai-service', 503, '').retryable).toBe(true)
    expect(new UpstreamError('ai-service', 400, '').retryable).toBe(false)
    expect(new UpstreamError('ai-service', 404, '').retryable).toBe(false)
  })

  it('maps to a catalog code and keeps upstream detail out of the user-facing error', () => {
    const err = new UpstreamError('ai-service', 500, 'gemini quota exceeded for project xyz')
    const appError = err.toAppError()

    expect(appError.code).toBe('AI_SERVICE_UNAVAILABLE')
    expect(appError.message).not.toContain('gemini')
    expect(new UpstreamError('payment-service', 500, '').toAppError().code).toBe(
      'SERVICE_UNAVAILABLE',
    )
  })
})
