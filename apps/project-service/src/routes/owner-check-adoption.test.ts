import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * assertProjectOwner exists because this check went missing once already.
 * Its own docstring records it: the check was inline on
 * GET /time-logs/project/:projectId/summary and absent from its siblings, so
 * any signed-in user could read another project's data by guessing an id.
 *
 * The helper was then called twice while handlers went on hand-rolling
 * select-then-compare - which is the same conditions that produced the gap.
 * Every route that only needs to know "does this person own it" now asks the
 * helper.
 *
 * Routes that also need the row itself - title for a filename, status for a
 * transition rule - still read it once and compare inline, because routing
 * them through the helper would mean two queries for one decision.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')
const helper = readFileSync(path.resolve(__dirname, '../lib/project-access.ts'), 'utf8')

describe('assertProjectOwner', () => {
  /**
   * A bare "Not authorized" on a route that used to say why is a regression
   * in the UI, and would be a reason not to adopt the helper. The message is
   * a parameter so adopting it never costs the owner an explanation.
   */
  it('lets the caller say what is being refused', () => {
    expect(helper).toContain('forbiddenMessage')
    expect(helper).toMatch(/AppError\('AUTH_FORBIDDEN', forbiddenMessage\)/)
  })
})

describe('projects routes', () => {
  it('asks the helper rather than re-deriving ownership', () => {
    const adopted = source.match(/assertProjectOwner\(/g) ?? []
    expect(adopted.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps telling the owner which action was refused', () => {
    for (const message of [
      'Only the project owner can view BRD',
      'Only the project owner can update this project',
      'Only the project owner can generate BRD',
      'Only the project owner can generate PRD',
    ]) {
      expect(source, `lost the message: ${message}`).toContain(message)
    }
  })

  /**
   * The pure ownership lookups are gone. What remains selects something else
   * alongside ownerId and is a different query, not a missed conversion.
   */
  it('has no ownership-only select left to drift', () => {
    const pureLookups =
      source.match(
        /\.select\(\{ ownerId: projectsTable\.ownerId \}\)[\s\S]{0,200}?ownerId !== /g,
      ) ?? []
    expect(pureLookups).toHaveLength(0)
  })
})
