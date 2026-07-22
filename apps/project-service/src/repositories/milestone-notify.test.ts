import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every milestone notification was dropped before it reached anyone.
 *
 * updateStatus publishes milestone.submitted, approved, rejected and
 * revision_requested with a payload of milestoneId, projectId, status and
 * changedBy. The notification consumer reads payload.talentId for the
 * recipient and, finding it empty, logs a warning, acks and returns. So a
 * talent was never told their milestone was approved, rejected, or that they
 * had seven days to complete a revision.
 *
 * notifications.user_id references user, not talent_profiles, so the id has to
 * come through a join. notifyAutoRelease in activities/milestone.activities.ts
 * already does exactly that, forty lines away, because the same bug was fixed
 * there once already.
 */

const repo = readFileSync(path.resolve(__dirname, './milestone.repository.ts'), 'utf8')
const activity = readFileSync(
  path.resolve(__dirname, '../activities/milestone.activities.ts'),
  'utf8',
)

function updateStatusBody(): string {
  const start = repo.indexOf('async updateStatus')
  expect(start).toBeGreaterThan(-1)
  return repo.slice(start, repo.indexOf('\n  async ', start + 10))
}

describe('milestone status events', () => {
  const body = updateStatusBody()

  it('carries a recipient at all', () => {
    expect(body).toContain('talentId')
  })

  // talent_profiles.id here would violate the foreign key on insert.
  it('resolves the recipient through talentProfiles, not the assignment id', () => {
    expect(body).toContain('talentProfiles')
    expect(body).toMatch(/userId/)
  })

  it('does not send assignedTalentId as the recipient', () => {
    expect(body).not.toMatch(/talentId:\s*\w*\.?assignedTalentId/)
  })
})

describe('the two publishers agree', () => {
  it('both join talentProfiles to reach a user id', () => {
    expect(activity).toContain('leftJoin(talentProfiles')
    expect(updateStatusBody()).toContain('talentProfiles')
  })
})
