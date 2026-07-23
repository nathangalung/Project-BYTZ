import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * updateStatus published only project.status.changed. The dedicated
 * project.completed event was never appended, so handleProjectCompleted in the
 * notification service never ran: no completion notification, dead email
 * handler. It reads payload.ownerId as the recipient, so the payload has to
 * carry it.
 */

const repo = readFileSync(path.resolve(__dirname, './project.repository.ts'), 'utf8')

function updateStatusBody(): string {
  const start = repo.indexOf('async updateStatus')
  expect(start).toBeGreaterThan(-1)
  return repo.slice(start, repo.indexOf('\n  async ', start + 10))
}

describe('project completion event', () => {
  const body = updateStatusBody()

  it('appends the dedicated project.completed subject', () => {
    expect(body).toContain('PROJECT_SUBJECTS.COMPLETED')
  })

  it('gates it on the completed transition', () => {
    expect(body).toMatch(/newStatus === ['"]completed['"]/)
  })

  it('carries the owner as the notification recipient', () => {
    expect(body).toContain('ownerId')
  })
})
