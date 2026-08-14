import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const SOURCE = readSource('./centrifugo.ts')

/**
 * Real-time chat is wired end to end - the message insert appends a
 * chat.message.sent outbox event, notification-service relays it to the
 * chat:{conversationId} channel, and the browser holds a subscription token
 * for it - but the client threw that away after three errors.
 *
 * centrifuge-js reconnects on its own with backoff. Its docs are explicit
 * that disconnect() stops that permanently until connect() is called again,
 * and that the way to stop retrying on a genuine auth failure is to throw
 * UnauthorizedError from getToken. The old handler did the opposite: it
 * disconnected on transport errors and never surfaced auth ones.
 */

describe('centrifugo client', () => {
  it('does not tear down the client on transport errors', () => {
    expect(SOURCE).not.toContain('failCount')
    // disconnect() may only appear in the explicit sign-out helper.
    const disconnects = SOURCE.match(/\.disconnect\(\)/g) ?? []
    expect(disconnects.length).toBe(1)
    expect(SOURCE).toContain('export function disconnectCentrifugo')
  })

  it('lets the library reconnect with bounded backoff', () => {
    expect(SOURCE).toContain('minReconnectDelay')
    expect(SOURCE).toContain('maxReconnectDelay')
  })

  /**
   * Returning '' from getToken looks like a token to the client, so it
   * retried a dead session forever. UnauthorizedError is the documented
   * signal to stop.
   */
  it('stops retrying only when the session is genuinely gone', () => {
    expect(SOURCE).toContain('UnauthorizedError')
    expect(SOURCE).toContain('res.status === 401')
    expect(SOURCE).toContain('res.status === 403')
  })

  it('still signs each private channel subscription separately', () => {
    expect(SOURCE).toContain('fetchSubscriptionToken')
    expect(SOURCE).toContain('/api/v1/realtime/subscription-token')
  })

  /**
   * The constructor does not open the socket. connectCentrifugo() only ran
   * inside useNotifications, which mounts on the notifications page and the
   * talent dashboard - not on Messages, milestones or project detail. Those
   * three subscribed to a socket nobody had opened.
   */
  it('opens the connection for every subscriber, not just notifications', () => {
    const body = SOURCE.slice(SOURCE.indexOf('export function subscribeTo'))
    expect(body).toContain('c.connect()')
  })
})
