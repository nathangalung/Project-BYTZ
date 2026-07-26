import { describe, expect, it } from 'vitest'
import { applyProjectVisibility } from './visibility'

/**
 * A public project page exists to advertise the work, not the buyer. The gate
 * stripped the money columns and stopped there, so a stranger reading
 * GET /projects/:id also got ownerId, the company name and role behind the
 * project, and a signed URL to the spec file the owner uploaded.
 *
 * ownerId is the part that bites: paired with GET /talents or a review it
 * names a real person, and it is the join key to every other route keyed on a
 * user. The company fields identify the buyer outright, and documentFileUrl
 * is the owner's own document - the same class of thing gateProjectBrd and
 * gateProjectPrd already withhold.
 *
 * Withheld from strangers only. An assigned talent is under contract and the
 * review form reads project.ownerId to address their review of the owner, so
 * participants keep the identity fields; only the money stays hidden.
 */

const stranger = null

const row = {
  ownerId: 'owner-1',
  visibility: 'public_detail',
  description: 'x'.repeat(300),
  title: 'Marketplace',
  budgetMin: 5_000_000,
  budgetMax: 9_000_000,
  estimatedTimelineDays: 60,
  preferences: { minExperience: 3 },
  projectType: 'company',
  companyName: 'PT Contoh',
  companyRole: 'CTO',
  documentFileUrl: 'https://storage/spec.pdf',
  documentType: 'pdf',
  finalPrice: 8_000_000,
  platformFee: 2_280_000,
  talentPayout: 5_720_000,
}

const IDENTITY_FIELDS = [
  'ownerId',
  'projectType',
  'companyName',
  'companyRole',
  'documentFileUrl',
  'documentType',
] as const

describe('stranger reading a public project', () => {
  for (const visibility of ['public_summary', 'public_detail'] as const) {
    describe(visibility, () => {
      const seen = applyProjectVisibility({ ...row, visibility }, stranger)

      for (const field of IDENTITY_FIELDS) {
        it(`withholds ${field}`, () => {
          expect(seen).not.toHaveProperty(field)
        })
      }

      it('still advertises the work', () => {
        expect(seen.title).toBe('Marketplace')
        expect(seen.estimatedTimelineDays).toBe(60)
      })

      // The owner's stated range is what the browse card already shows, and
      // it is not the agreed price: finalPrice and the payout stay hidden.
      it('keeps the owner budget range but no settled money', () => {
        expect(seen.budgetMin).toBe(5_000_000)
        expect(seen.budgetMax).toBe(9_000_000)
        expect(seen).not.toHaveProperty('finalPrice')
        expect(seen).not.toHaveProperty('platformFee')
        expect(seen).not.toHaveProperty('talentPayout')
      })
    })
  }
})

describe('assigned talent', () => {
  const seen = applyProjectVisibility(row, 'talent-user-1', true)

  /**
   * The review form addresses talent_to_owner reviews with project.ownerId.
   * Stripping it for participants would leave the talent unable to review the
   * owner at all, so the identity strip is deliberately stranger-only.
   */
  it('still reads ownerId so it can review the owner', () => {
    expect(seen.ownerId).toBe('owner-1')
  })

  it('sees the full brief', () => {
    expect(seen.description).toBe(row.description)
    expect(seen.preferences).toEqual({ minExperience: 3 })
  })

  it('never sees the money', () => {
    expect(seen).not.toHaveProperty('finalPrice')
    expect(seen).not.toHaveProperty('talentPayout')
  })
})

describe('owner', () => {
  it('sees the row as stored', () => {
    const seen = applyProjectVisibility(row, 'owner-1')
    expect(seen).toEqual(row)
  })
})
