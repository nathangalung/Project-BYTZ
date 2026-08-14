import { readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeBrdContent } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const PREVIEW = readSource('./_authenticated/projects/$projectId/brd.tsx')

/**
 * The BRD was normalised twice - here for the preview, and in brd-pdf.ts for
 * the paid download - because the stored column is model-authored snake_case
 * and the app is camelCase. The copies drifted in both directions: the
 * preview missed estimated_team_size and showed a team of one, while the PDF
 * dropped legacy risk objects and requirement bodies, so the document the
 * owner paid for held less than the free preview.
 *
 * One normaliser now serves both, in packages/shared alongside prd-content.
 * The field-by-field behaviour is tested there. What is left to hold here is
 * that this page still delegates, and that the number an owner reads on
 * screen is the number the PDF prints.
 */

describe('BRD preview', () => {
  it('delegates to the shared normaliser', () => {
    expect(PREVIEW).toContain('normalizeBrdContent')
  })

  /**
   * Only spellings that cannot be anything but a field remap. Some stored
   * keys double as i18n keys - non_functional_requirements is a section
   * heading here - so matching those would fail on the translation call.
   */
  it('grows no second copy of the field mapping', () => {
    for (const key of ['estimated_team_size', 'estimated_price_min', 'estimated_timeline_days']) {
      expect(PREVIEW, `${key} is being remapped here again`).not.toContain(key)
    }
  })

  /**
   * The preview adds templateScore, which the PDF has no business carrying:
   * it is guidance for revising, not part of the deliverable.
   */
  it('adds only the preview-only score on top', () => {
    expect(PREVIEW).toContain('templateScore')
    expect(normalizeBrdContent({})).not.toHaveProperty('templateScore')
  })
})

describe('the number the owner reads', () => {
  it('is the same on screen as in the PDF', () => {
    // Both surfaces call this one function, so agreement is structural.
    expect(normalizeBrdContent({ estimated_team_size: 4 }).estimatedTeamSize).toBe(4)
    expect(normalizeBrdContent({ estimatedTeamSize: 4 }).estimatedTeamSize).toBe(4)
    expect(normalizeBrdContent({ team_size: 4 }).estimatedTeamSize).toBe(4)
  })
})
