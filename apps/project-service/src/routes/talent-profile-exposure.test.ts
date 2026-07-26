import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInternalTalentColumn, PUBLIC_TALENT_COLUMNS } from '../lib/talent-visibility'

/**
 * GET /talent-profiles/user/:userId ran a bare select() and returned the row.
 *
 * CLAUDE.md keeps tier and average_rating internal, so that a client picks on
 * competence rather than reputation, and treats cv_parsed_data as personal
 * data. The route handed all of it to any signed-in caller, along with
 * hourly_rate_expectation and pemerataan_penalty.
 *
 * It was survivable while cv_parsed_data was always null, because nothing
 * wrote it. Persisting the CV parse changed that: the column now holds the
 * talent's name, email, phone, education and employment history, and
 * cv_file_url is a live storage key.
 *
 * GET /me in the same file already hand-listed its columns.
 */

const source = readFileSync(path.resolve(__dirname, './talent-profiles.ts'), 'utf8')

describe('columns another signed-in user may read', () => {
  it.each(['tier', 'averageRating', 'cvParsedData', 'cvFileUrl', 'pemerataanPenalty'])(
    'withholds %s',
    (column) => {
      expect(isInternalTalentColumn(column)).toBe(true)
      expect(Object.keys(PUBLIC_TALENT_COLUMNS)).not.toContain(column)
    },
  )

  it.each(['bio', 'yearsOfExperience', 'domainExpertise', 'educationUniversity'])(
    'still shows %s, which is what a client judges on',
    (column) => {
      expect(Object.keys(PUBLIC_TALENT_COLUMNS)).toContain(column)
    },
  )

  /**
   * Anonymity before a deal is partial, not total: an owner sees the alias,
   * the university and the background, and judges on those. What they do not
   * get is a way to reach the talent directly. portfolioLinks is exactly that
   * - GitHub and LinkedIn URLs carry the real name, and
   * disintermediation.service.ts already treats those two domains as bypass
   * attempts when they appear in chat. Serving them from the profile handed
   * over what the chat filter exists to stop.
   */
  it('withholds the contact links until there is a deal', () => {
    expect(Object.keys(PUBLIC_TALENT_COLUMNS)).not.toContain('portfolioLinks')
  })

  it('does not leave the rate expectation on show', () => {
    expect(isInternalTalentColumn('hourlyRateExpectation')).toBe(true)
  })
})

describe('GET /user/:userId', () => {
  const handler = source.slice(source.indexOf("talentProfileRoute.get('/user/:userId'"))
  const body = handler.slice(0, handler.indexOf('talentProfileRoute.', 1))

  it('projects for anyone who is not the profile owner', () => {
    expect(body).toContain('PUBLIC_TALENT_COLUMNS')
  })

  // The unprojected select is only reachable on the self branch.
  it('gates the full row on the caller being that user', () => {
    expect(body).toContain('getAuthUser')
    expect(body).toMatch(/viewer\.id === userId/)
  })
})
