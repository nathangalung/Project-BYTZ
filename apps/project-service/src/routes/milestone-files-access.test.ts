import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GET /milestones/:id/files called getAuthUser and stopped there, so being
 * signed in was enough to list any milestone's attachments by id: file names,
 * sizes and storage URLs for another project's deliverables. Its siblings in
 * time-logs and work-packages call assertProjectAccess for exactly this.
 *
 * The stored fileUrl is also a bare object URL. The bucket is private now, so
 * the browser cannot fetch it: the route has to hand back a presigned GET,
 * which it can do safely because it has just checked access.
 */

const source = readFileSync(path.resolve(__dirname, './milestones.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('milestonesRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('GET /milestones/:id/files', () => {
  const body = handler("milestonesRoute.get('/milestones/:id/files'")

  it('checks project access, not just a session', () => {
    expect(body).toContain('assertProjectAccess')
  })

  it('signs the URLs it returns', () => {
    expect(body).toContain('presignStoredObject')
  })
})

describe('POST /milestones/:id/files', () => {
  const body = handler("milestonesRoute.post('/milestones/:id/files'")

  it('checks project access before recording an attachment', () => {
    expect(body).toContain('assertProjectAccess')
  })
})
