import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_TALENT_COLUMNS } from '../lib/talent-visibility'

/**
 * Talent anonymity before a deal is one rule, and it was being enforced in
 * one route while two others hand-rolled their own column list.
 *
 * PUBLIC_TALENT_COLUMNS exists precisely so there is a single answer to "what
 * may a stranger see of a talent". It was called from
 * GET /talent-profiles/user/:userId and nowhere else, while GET /talents and
 * GET /talents/:id each picked their own columns - and /talents/:id was still
 * serving portfolio_links, which was removed from the allowlist because a
 * GitHub or LinkedIn URL carries the talent's real name and a direct
 * off-platform channel. disintermediation.service.ts treats those same two
 * domains as bypass attempts when they appear in chat.
 *
 * So the fix that closed the leak on one route left it open on another, and
 * a stranger holding a talent id could still read it.
 */

const DIR = path.resolve(__dirname)
const talents = readFileSync(path.join(DIR, 'talents.ts'), 'utf8')
const profiles = readFileSync(path.join(DIR, 'talent-profiles.ts'), 'utf8')

describe('the anonymity allowlist', () => {
  it('withholds the contact links', () => {
    expect(Object.keys(PUBLIC_TALENT_COLUMNS)).not.toContain('portfolioLinks')
  })

  it('withholds the CV file and the rate expectation', () => {
    for (const column of ['cvFileUrl', 'cvParsedData', 'hourlyRateExpectation', 'tier']) {
      expect(Object.keys(PUBLIC_TALENT_COLUMNS)).not.toContain(column)
    }
  })
})

describe('every route serving a talent to a stranger', () => {
  /**
   * The point of an allowlist is that adding a column to the table cannot
   * expose it by accident. A route with its own hand-written list defeats
   * that, and is how portfolio_links survived being withheld.
   */
  it('reads the allowlist rather than picking columns', () => {
    expect(talents).toContain('PUBLIC_TALENT_COLUMNS')
    expect(profiles).toContain('PUBLIC_TALENT_COLUMNS')
  })

  it('serves no contact link from the talent routes', () => {
    expect(talents, 'talents.ts still selects portfolioLinks').not.toContain(
      'talentProfiles.portfolioLinks',
    )
  })

  it('serves no CV or rate from the talent routes', () => {
    for (const column of ['cvFileUrl', 'cvParsedData', 'hourlyRateExpectation']) {
      expect(talents, `talents.ts still selects ${column}`).not.toContain(
        `talentProfiles.${column}`,
      )
    }
  })

  /**
   * tier is internal by design - CLAUDE.md is explicit that neither the owner
   * nor the talent may see it, because a visible tier becomes a ranking and
   * a ranking defeats the pemerataan the platform is built on.
   */
  it('never serves the internal tier', () => {
    expect(talents).not.toContain('talentProfiles.tier')
    expect(profiles).not.toMatch(/tier: talentProfiles\.tier/)
  })
})
