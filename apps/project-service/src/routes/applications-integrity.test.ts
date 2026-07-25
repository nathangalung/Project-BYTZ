import { readFileSync } from 'node:fs'
import path from 'node:path'
import { APPLICATION_SUBJECTS } from '@kerjacus/nats-events'
import { describe, expect, it } from 'vitest'

/**
 * Applying to a project touched three things that were wrong in different
 * ways: the list route let one applicant read every rival, rejecting an
 * applicant reused the subject a talent uses to quit so the owner was told
 * their own team member had left, and accepting emitted a subject nothing
 * consumes so the talent heard nothing at all.
 */

const source = readFileSync(path.resolve(__dirname, './applications.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('applicationRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('application events', () => {
  /**
   * talent.assignment.declined means a hired talent walked away, and
   * notification-service emails the owner that a position reopened. Sending
   * it when the owner rejects an applicant tells them the opposite of what
   * happened.
   */
  it('has its own accepted and rejected subjects', () => {
    expect(APPLICATION_SUBJECTS.STATUS_ACCEPTED).toBe('application.status.accepted')
    expect(APPLICATION_SUBJECTS.STATUS_REJECTED).toBe('application.status.rejected')
  })

  it('does not borrow the assignment subjects for an application decision', () => {
    expect(source).not.toContain('TALENT_SUBJECTS.ASSIGNMENT_ACCEPTED')
    expect(source).not.toContain('TALENT_SUBJECTS.ASSIGNMENT_DECLINED')
  })
})

describe('GET /projects/:projectId/applications', () => {
  const body = handler("applicationRoute.get('/project/:projectId'")

  /**
   * The route authorised any talent who had applied, then returned every
   * application on the project. One application bought the identity and
   * cover note of everyone competing for the same work.
   */
  it('shows an applicant only their own application', () => {
    expect(body).toContain('viewerTalentId')
    expect(body).toMatch(/eq\(projectApplications\.talentId, viewerTalentId\)/)
  })
})

describe('POST /projects/:projectId/applications', () => {
  const body = handler("applicationRoute.post('/'")

  /**
   * The duplicate check matched on (projectId, talentId) with no status
   * predicate, so withdrawing was irreversible: the withdrawn row still
   * counted and the talent could never apply again.
   */
  it('lets a talent apply again after withdrawing or being rejected', () => {
    expect(body).toContain('ACTIVE_APPLICATION_STATUSES')
  })
})
