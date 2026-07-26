import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Reading a conversation checked chat_participants. Posting to one did not.
 *
 * The send handler also swallowed the auth error so that a non-user senderType
 * needed no session at all, and it took senderType straight from the body. A
 * signed-in stranger could post into any conversation as 'system': the row was
 * stored with a null sender, so it read as coming from the platform, and
 * detectBypassAttempts only runs on senderType 'user', so it skipped the
 * disintermediation scan entirely. That scan is the whole point of routing
 * chat through the platform.
 *
 * The web client only ever sends senderType 'user' (use-chat-messages.ts:111),
 * so a session caller has no legitimate reason to name anything else.
 */

const source = readFileSync(path.resolve(__dirname, './chat.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const rest = source.slice(start + marker.length)
  const next = rest.indexOf('chatRoute.')
  return rest.slice(0, next === -1 ? undefined : next)
}

describe('POST /conversations/:id/messages', () => {
  const body = handler("chatRoute.post('/conversations/:id/messages'")

  /**
   * The participant lookup moved into ChatRepository, so this asserts the
   * route still asks - and that a non-participant is refused rather than
   * quietly allowed to post into a conversation they are not in.
   */
  it('checks the sender is a participant, as the read route does', () => {
    expect(body).toContain('isParticipant')
    expect(body).toContain('Not a participant in this conversation')
  })

  it('does not swallow the session error', () => {
    expect(body).not.toMatch(/catch\s*\{\s*\n\s*\/\/ Allow unauthenticated/)
  })

  it('does not take the sender type from the body for a session caller', () => {
    expect(body).toMatch(/X-Service-Auth|isService/)
  })

  it('scans every user message for bypass attempts', () => {
    expect(body).toContain('detectBypassAttempts')
  })
})

describe('POST /conversations', () => {
  const body = handler("chatRoute.post('/conversations'")

  // Creating a conversation on someone else's project made the creator a
  // participant, which then satisfied the read check.
  it('checks the caller belongs to the project', () => {
    expect(body).toMatch(/assertProjectAccess/)
  })
})
