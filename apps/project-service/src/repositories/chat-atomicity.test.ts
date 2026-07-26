import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Opening a conversation wrote the conversation, then looped inserting one
 * participant row at a time, none of it in a transaction.
 *
 * Reading a conversation is gated on being a participant. So a failure
 * partway through that loop left a conversation that existed and could not
 * be read - and because the creator happened to be inserted first only by
 * accident of Set ordering, the person who opened it could be the one locked
 * out, with no route to repair it.
 *
 * Sending a message had the same shape at a different scale: the bypass
 * event has to land with the message it describes, or a rolled-back message
 * still raises a disintermediation warning against a user for something they
 * never said.
 */

const repo = readFileSync(path.resolve(__dirname, './chat.repository.ts'), 'utf8')
const route = readFileSync(path.resolve(__dirname, '../routes/chat.ts'), 'utf8')

function method(name: string): string {
  const start = repo.indexOf(`async ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = repo.indexOf('\n  async ', start + 10)
  return repo.slice(start, next === -1 ? repo.length : next)
}

describe('opening a conversation', () => {
  const body = method('createConversation')

  it('writes the conversation and its participants together', () => {
    expect(body).toContain('this.db.transaction')
  })

  /**
   * One insert with many values, not one insert per participant. A loop
   * inside a transaction is still N round trips for something the database
   * will take in a single statement.
   */
  it('inserts the participants in one statement', () => {
    expect(body).toContain('participants.map')
    expect(body).not.toMatch(/for \(const .* of participants\)/)
  })

  it('always makes the creator a participant', () => {
    expect(body).toContain('new Set([input.creatorId')
  })

  /**
   * The old code assigned `participantId === userId ? 'member' : 'member'` -
   * a ternary whose branches were identical. It read as though the creator
   * were being given a different role and did nothing at all.
   */
  it('does not pretend the creator gets a different role', () => {
    expect(route).not.toMatch(/\?\s*'member'\s*:\s*'member'/)
  })
})

describe('sending a message', () => {
  const body = method('createMessage')

  it('stores the message and its events together', () => {
    expect(body).toContain('this.db.transaction')
  })

  // A warning must not outlive the message that caused it.
  it('publishes the bypass warning inside the same transaction', () => {
    const tx = body.slice(body.indexOf('this.db.transaction'))
    expect(tx).toContain('chat.bypass_detected')
    expect(tx).toContain('chat.message.sent')
  })

  // A service posting as the platform has no user to warn about.
  it('raises no warning without a sender', () => {
    expect(body).toMatch(/bypassPatterns\.length > 0 && input\.senderId/)
  })
})
