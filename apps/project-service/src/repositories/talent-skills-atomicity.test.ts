import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Saving a talent profile replaced their skills by deleting every row and
 * re-inserting them one at a time, outside any transaction.
 *
 * Skills are what findEligibleTalents filters on. So a failure partway
 * through left a talent whose skills had been deleted and only partly
 * restored, and they quietly stopped being matchable for work they can
 * do - with nothing anywhere to say it had happened. Re-saving the profile
 * was the only repair, and nobody would know to try it.
 *
 * The taxonomy lookup deliberately stays outside the transaction: those are
 * reads that can miss, and holding a write open across them would keep a
 * lock for the whole resolution rather than for the write it protects.
 */

const repo = readFileSync(path.resolve(__dirname, './talent-profile.repository.ts'), 'utf8')
const route = readFileSync(path.resolve(__dirname, '../routes/talent-profiles.ts'), 'utf8')

describe('saving a talent profile', () => {
  it('writes the profile and its skills together', () => {
    expect(repo).toContain('this.db.transaction')
    const tx = repo.slice(repo.indexOf('this.db.transaction'))
    expect(tx).toContain('delete(talentSkills)')
    expect(tx).toContain('insert(talentSkills)')
  })

  /**
   * One insert with many values, not one per skill. A loop inside a
   * transaction is still N round trips for what the database takes at once.
   */
  it('inserts the skills in one statement', () => {
    expect(repo).toContain('skills.map(')
    expect(repo).not.toMatch(/for \(const s of skills\)/)
  })

  /**
   * An absent list means unchanged, not "this talent has no skills". Reading
   * it the other way would wipe the skills of every caller who submitted a
   * profile edit without touching them.
   */
  it('leaves the skills alone when none were supplied', () => {
    expect(repo).toMatch(/if \(skills\)/)
  })

  it('resolves the taxonomy before opening the write', () => {
    const resolve = route.indexOf('resolveSkillId')
    const save = route.indexOf('repo.save(')
    expect(resolve).toBeGreaterThan(-1)
    expect(save).toBeGreaterThan(resolve)
  })

  /**
   * Verification comes from CV parsing. Editing a bio is not grounds to
   * revoke it, and resetting it here dropped the talent out of matching and
   * the directory at once.
   */
  it('never resets verification on an edit', () => {
    const update = repo.slice(repo.indexOf('if (existingId)'), repo.indexOf('} else {'))
    expect(update).not.toContain('verificationStatus')
  })
})
