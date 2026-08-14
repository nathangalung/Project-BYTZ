import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { correlationId } from './correlation-id'

/**
 * The header that makes a request followable across six services.
 *
 * Two rules, and both are load-bearing for tracing. An inbound X-Request-ID is
 * adopted rather than replaced, because the gateway or the calling service
 * already put this request's id on the wire and minting a new one here severs
 * the trace at the service boundary. When there is none, one is minted, because
 * a request with no id cannot be correlated at all.
 *
 * The id is also echoed on the response, which is what lets a user quote it
 * from a failed request and have support find the logs.
 */

function app() {
  const instance = new Hono()
  instance.use('*', correlationId)
  instance.get('/', (c) => c.json({ requestId: c.get('requestId' as never) }))
  return instance
}

describe('correlationId', () => {
  it('adopts an inbound request id rather than minting a new one', async () => {
    const inbound = '01a00000-0000-7000-8000-000000000001'

    const res = await app().request('/', { headers: { 'X-Request-ID': inbound } })

    expect(res.headers.get('X-Request-ID')).toBe(inbound)
    expect(await res.json()).toEqual({ requestId: inbound })
  })

  it('mints a request id when the caller sent none', async () => {
    const res = await app().request('/')

    const minted = res.headers.get('X-Request-ID')
    // UUID v7: the version nibble is what makes it time-sortable, and
    // CLAUDE.md forbids the v4 that crypto.randomUUID would produce.
    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await res.json()).toEqual({ requestId: minted })
  })

  it('mints a distinct id per request', async () => {
    const instance = app()

    const first = (await instance.request('/')).headers.get('X-Request-ID')
    const second = (await instance.request('/')).headers.get('X-Request-ID')

    expect(first).not.toBe(second)
  })

  /** The context variable and the response header must agree, or a log line
   * and the id the user quotes name different requests. */
  it('puts the same id on the context and the response', async () => {
    const res = await app().request('/')

    const body = (await res.json()) as { requestId: string }
    expect(body.requestId).toBe(res.headers.get('X-Request-ID'))
  })
})
