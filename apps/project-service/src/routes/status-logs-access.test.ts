import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GET /projects/:id/status-logs called getService and stopped there, so any
 * signed-in user could read another project's audit trail by id: who moved it,
 * to which status, when, and the reason they typed. Its siblings on activities
 * and disputes call assertProjectAccess for exactly this.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

const marker = "projectsRoute.get('/:id/status-logs'"
const start = source.indexOf(marker)
const next = source.indexOf('projectsRoute.', start + marker.length)
const body = source.slice(start, next === -1 ? source.length : next)

describe('GET /projects/:id/status-logs', () => {
  it('is present', () => {
    expect(start).toBeGreaterThan(-1)
  })

  it('checks project access, not just a session', () => {
    expect(body).toContain('assertProjectAccess')
  })

  it('checks before it reads', () => {
    expect(body.indexOf('assertProjectAccess')).toBeLessThan(body.indexOf('getStatusLogs'))
  })
})
