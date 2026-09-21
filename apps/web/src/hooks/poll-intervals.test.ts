import { describe, expect, it } from 'vitest'
import { CHAT_MESSAGES_POLL_MS, CONVERSATIONS_POLL_MS } from './use-chat-messages'
import { NOTIFICATION_POLL_MS } from './use-notifications'

/**
 * Polling is a backstop to Centrifugo, not the transport.
 *
 * Every signed-in tab runs the two notification queries for as long as it is
 * open, so these numbers multiply by the number of open tabs into a request
 * floor the platform pays while nothing is happening. The rule they encode:
 * a key a realtime channel invalidates may poll slowly, a key nothing pushes
 * may not.
 */
describe('poll intervals', () => {
  it('polls realtime-covered keys no more than once every two minutes', () => {
    // notifications#<userId> invalidates the ['notifications'] prefix,
    // chat:<id> invalidates ['chat-messages', id].
    expect(NOTIFICATION_POLL_MS).toBeGreaterThanOrEqual(120_000)
    expect(CHAT_MESSAGES_POLL_MS).toBeGreaterThanOrEqual(120_000)
  })

  it('keeps the notification backstop the slowest of the three', () => {
    // Two queries, mounted on every authenticated page, and a bell is the
    // least urgent thing on it.
    expect(NOTIFICATION_POLL_MS).toBeGreaterThan(CHAT_MESSAGES_POLL_MS)
  })

  it('does not slow the conversation list, which nothing pushes', () => {
    // No channel invalidates ['conversations']; this poll is the only way a
    // conversation opened by the other side appears. Raising it past the
    // realtime-backed keys would be a regression, not a saving.
    expect(CONVERSATIONS_POLL_MS).toBeLessThanOrEqual(CHAT_MESSAGES_POLL_MS)
  })

  it('never polls faster than once a minute', () => {
    for (const interval of [NOTIFICATION_POLL_MS, CHAT_MESSAGES_POLL_MS, CONVERSATIONS_POLL_MS]) {
      expect(interval).toBeGreaterThanOrEqual(60_000)
    }
  })
})
