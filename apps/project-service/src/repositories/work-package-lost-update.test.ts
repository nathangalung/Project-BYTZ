import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Setting a work package status is read, check, write, and the write was
 * unconditional.
 *
 * WorkPackageService.updateStatus reads the row, throws if it is gone, then
 * discards what it read and calls the repository, which writes
 * `.where(eq(workPackages.id, id))`. Two callers that both read the row both
 * pass the existence check and both write.
 *
 * This status is not bookkeeping, it is the team formation gate. matching.ts
 * offers positions `WHERE status IN ('unassigned')`, applications.ts picks the
 * free package from ('unassigned','declined'), and allPackagesStaffed counts
 * these values to promote a project to matched. Only the accept path in
 * matching.ts serialises on the project row; the confirm and decline paths and
 * the accept in applications.ts write on the work package id alone. So this
 * route could clobber an `assigned` that a talent acceptance just committed,
 * leaving a matched project holding an unassigned package /positions reoffers.
 *
 * The status the caller read has to reach the predicate, so the database
 * decides the race rather than whichever transaction commits last.
 */

const repoSource = readFileSync(path.resolve(__dirname, './work-package.repository.ts'), 'utf8')
const serviceSource = readFileSync(
  path.resolve(__dirname, '../services/work-package.service.ts'),
  'utf8',
)

function method(source: string, name: string): string {
  const start = source.indexOf(`async ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('\n  async ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('WorkPackageRepository.updateStatus', () => {
  const body = method(repoSource, 'updateStatus')

  it('takes the status the caller read', () => {
    expect(body).toMatch(/expectedStatus/)
  })

  /**
   * The predicate is the guard. Keying on the id alone lets the second writer
   * through no matter what it read.
   */
  it('writes only while the row still holds that status', () => {
    expect(body).toMatch(/eq\(workPackages\.status,\s*expectedStatus\)/)
  })

  /**
   * Scoped to the update chain on purpose. The conflict branch reads by id
   * alone, legitimately, to report what the row moved to instead.
   */
  it('does not write on the id alone', () => {
    const update = body.slice(body.indexOf('.update(workPackages)'), body.indexOf('.returning()'))
    expect(update).not.toMatch(/\.where\(\s*eq\(workPackages\.id,\s*id\)\s*\)/)
    expect(update).toContain('and(')
  })

  /**
   * Losing the race has to be distinguishable from the row not existing, or
   * the caller cannot tell a conflict from a 404.
   */
  it('reports a lost race as a conflict', () => {
    expect(body).toContain('CONFLICT')
  })
})

describe('WorkPackageService.updateStatus', () => {
  const body = method(serviceSource, 'updateStatus')

  /**
   * The service already reads the row for the existence check. Carrying that
   * read forward is the whole fix; discarding it is the bug.
   */
  it('carries the status it read into the write', () => {
    expect(body).toMatch(/updateStatus\(\s*id,\s*status,\s*wp\.status/)
  })
})
