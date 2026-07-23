import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Being signed in is not the same as being a party to a project.
 *
 * index.ts resolves a session for every /api/v1 route outside a short public
 * allowlist, which proves the caller exists. It says nothing about whether the
 * project, dispute or milestone in the URL is any of their business. The
 * routes below skipped that second check entirely, so a signed-in stranger
 * could read another project's payment schedule, its dispute evidence, its
 * internal ratings and its activity history by id.
 *
 * project-access.ts already has both helpers: assertProjectAccess for owner or
 * assigned talent, assertProjectOwner for the owner alone. Sibling routes in
 * the same files were already calling them.
 */

const routes = path.resolve(__dirname)
const read = (file: string) => readFileSync(path.join(routes, file), 'utf8')

function handler(source: string, marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const rest = source.slice(start + marker.length)
  const nextRoute = rest.search(/\n(disputeRoute|milestonesRoute|activityRoute|reviewRoute)\./)
  return rest.slice(0, nextRoute === -1 ? undefined : nextRoute)
}

describe('milestones', () => {
  const source = read('milestones.ts')

  // The full payment schedule of a project: title, amount, due date.
  it('checks project access before listing them', () => {
    const body = handler(source, "milestonesRoute.get('/projects/:projectId/milestones'")
    expect(body).toContain('assertProjectAccess')
  })

  // Integration milestones carry no assignedTalentId, so the single-assignee
  // check recognises nobody and submission 403s for every contributing talent.
  // A project-level talent check has to stand in.
  it('lets a talent assigned to the project act on an integration milestone', () => {
    const body = handler(source, "milestonesRoute.patch('/milestones/:id/status'")
    expect(body).toContain('isAssignedTalent')
  })
})

describe('activities', () => {
  const source = read('activities.ts')

  it('checks project access on the per-project feed', () => {
    const body = handler(source, "activityRoute.get('/project/:projectId'")
    expect(body).toContain('assertProjectAccess')
  })

  // Unscoped it was every activity on the platform, which also handed out
  // the project ids needed to reach the other routes here.
  it('scopes the global feed to the caller', () => {
    const body = handler(source, "activityRoute.get('/'")
    expect(body).toContain('getAuthUser')
    expect(body).toMatch(/where|visibleProjectIds/)
  })
})

describe('disputes', () => {
  const source = read('disputes.ts')

  it('keeps the platform-wide list to admins', () => {
    const body = handler(source, "disputeRoute.get('/'")
    expect(body).toMatch(/role !== 'admin'/)
  })

  it('checks who is asking before returning one dispute', () => {
    const body = handler(source, "disputeRoute.get('/:id'")
    expect(body).toContain('getAuthUser')
    expect(body).toMatch(/initiatedBy|assertProjectAccess/)
  })

  it('checks project access on the per-project list', () => {
    const body = handler(source, "disputeRoute.get('/project/:projectId'")
    expect(body).toContain('assertProjectAccess')
  })
})

describe('reviews', () => {
  const source = read('reviews.ts')

  // Ratings are internal so a high one does not compound into more work.
  it('checks project access before returning a project of reviews', () => {
    const body = handler(source, "reviewRoute.get('/project/:projectId'")
    expect(body).toContain('assertProjectAccess')
  })

  it('lets a user read only reviews they wrote or received', () => {
    const body = handler(source, "reviewRoute.get('/user/:userId'")
    expect(body).toContain('getAuthUser')
    expect(body).toMatch(/AUTH_FORBIDDEN/)
  })

  it('leaves the public testimonial route alone', () => {
    const body = handler(source, "reviewRoute.get('/public'")
    expect(body).toContain('isPublicTestimonial')
  })
})
