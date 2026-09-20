import { describe, expect, it } from 'vitest'
import {
  buildProfilePayload,
  draftFromProfile,
  type ProfileDraft,
  profileCompleteness,
  type TalentProfile,
  toProficiencyLevel,
  validateProfileDraft,
} from './shared'

/**
 * The rules behind the edit form, tested without rendering it.
 *
 * The completeness score is what the page tells a talent to act on, and the
 * payload is what a save actually sends -- both are decisions rather than
 * markup, so they are kept as functions and checked here.
 */

const EMPTY: TalentProfile = {
  id: 'tp-1',
  userId: 'u-1',
  bio: '',
  yearsOfExperience: 0,
  tier: 'junior',
  educationUniversity: null,
  educationMajor: null,
  educationYear: null,
  location: null,
  cvFileUrl: null,
  portfolioLinks: [],
  availabilityStatus: 'available',
  verificationStatus: 'unverified',
  domainExpertise: [],
  totalProjectsCompleted: 0,
  totalProjectsActive: 0,
  averageRating: null,
  skills: [],
}

const FULL: TalentProfile = {
  ...EMPTY,
  bio: 'Membangun marketplace.',
  yearsOfExperience: 4,
  educationUniversity: 'ITB',
  educationMajor: 'Informatika',
  educationYear: 2019,
  location: 'Bandung',
  cvFileUrl: 'cv/ari.pdf',
  portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/ari' }],
  domainExpertise: ['Fintech'],
  skills: [{ name: 'React', category: 'frontend', proficiencyLevel: 'advanced', isPrimary: true }],
}

describe('profileCompleteness', () => {
  it('scores an untouched profile at zero and names every piece', () => {
    expect(profileCompleteness(EMPTY)).toEqual({
      percent: 0,
      missing: ['bio', 'experience', 'education', 'skills', 'portfolio', 'domain', 'cv'],
    })
  })

  it('scores a filled profile at 100 with nothing left to do', () => {
    expect(profileCompleteness(FULL)).toEqual({ percent: 100, missing: [] })
  })

  it('rounds a partial profile and lists only what is absent', () => {
    const { percent, missing } = profileCompleteness({ ...FULL, cvFileUrl: null, skills: [] })

    expect(percent).toBe(71)
    expect(missing).toEqual(['skills', 'cv'])
  })

  it('does not count whitespace as a bio', () => {
    expect(profileCompleteness({ ...EMPTY, bio: '   ' }).missing).toContain('bio')
  })

  it.each([
    ['educationUniversity', { educationUniversity: 'ITB' }],
    ['educationMajor', { educationMajor: 'Informatika' }],
    ['educationYear', { educationYear: 2019 }],
  ])('counts education as present from %s alone', (_label, patch) => {
    expect(profileCompleteness({ ...EMPTY, ...patch }).missing).not.toContain('education')
  })

  /** The API has shipped responses with these keys absent. */
  it('treats missing list fields as empty rather than throwing', () => {
    const partial = {
      ...EMPTY,
      skills: undefined,
      portfolioLinks: undefined,
      domainExpertise: undefined,
    } as unknown as TalentProfile

    expect(profileCompleteness(partial).percent).toBe(0)
  })
})

describe('toProficiencyLevel', () => {
  it('keeps a level the write schema accepts', () => {
    expect(toProficiencyLevel('expert')).toBe('expert')
  })

  it('falls back rather than sending a value the schema rejects', () => {
    expect(toProficiencyLevel('guru')).toBe('intermediate')
  })
})

describe('draftFromProfile', () => {
  it('reads every editable field out of the stored profile', () => {
    expect(draftFromProfile(FULL, 'Ari')).toEqual({
      name: 'Ari',
      bio: 'Membangun marketplace.',
      yearsOfExperience: '4',
      location: 'Bandung',
      educationUniversity: 'ITB',
      educationMajor: 'Informatika',
      educationYear: '2019',
      skills: [
        { name: 'React', category: 'frontend', proficiencyLevel: 'advanced', isPrimary: true },
      ],
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/ari' }],
      domainExpertise: ['Fintech'],
    })
  })

  it('turns every absent field into an empty input rather than "null"', () => {
    const draft = draftFromProfile({ ...EMPTY, bio: null as unknown as string }, 'Ari')

    expect(draft.bio).toBe('')
    expect(draft.location).toBe('')
    expect(draft.educationUniversity).toBe('')
    expect(draft.educationMajor).toBe('')
    expect(draft.educationYear).toBe('')
  })

  /** Editing the copy must not mutate the query cache's arrays. */
  it('copies the lists instead of aliasing them', () => {
    const draft = draftFromProfile(FULL, 'Ari')

    expect(draft.portfolioLinks).not.toBe(FULL.portfolioLinks)
    expect(draft.domainExpertise).not.toBe(FULL.domainExpertise)
  })

  it('survives a response with no lists at all', () => {
    const partial = {
      ...EMPTY,
      skills: undefined,
      portfolioLinks: undefined,
      domainExpertise: undefined,
    } as unknown as TalentProfile

    expect(draftFromProfile(partial, 'Ari').skills).toEqual([])
  })
})

describe('validateProfileDraft', () => {
  const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
    ...draftFromProfile(FULL, 'Ari'),
    ...overrides,
  })

  it('accepts a draft the write schema will take', () => {
    expect(validateProfileDraft(draft())).toBeNull()
  })

  it.each([
    ['an empty name', { name: '  ' }, 'name_required'],
    ['a name shorter than the server minimum', { name: 'A' }, 'name_required'],
    ['no experience at all', { yearsOfExperience: '' }, 'experience_invalid'],
    ['experience that is not a number', { yearsOfExperience: 'lima' }, 'experience_invalid'],
    ['negative experience', { yearsOfExperience: '-1' }, 'experience_invalid'],
    ['fractional experience', { yearsOfExperience: '2.5' }, 'experience_invalid'],
    ['no skills left', { skills: [] }, 'skills_required'],
  ])('rejects %s', (_label, patch, key) => {
    expect(validateProfileDraft(draft(patch))).toBe(key)
  })

  it('accepts zero years, which is a real answer', () => {
    expect(validateProfileDraft(draft({ yearsOfExperience: '0' }))).toBeNull()
  })
})

describe('buildProfilePayload', () => {
  it('sends the fields the write schema requires', () => {
    const payload = buildProfilePayload('u-1', draftFromProfile(FULL, 'Ari'))

    expect(payload.userId).toBe('u-1')
    expect(payload.yearsOfExperience).toBe(4)
    expect(payload.educationYear).toBe(2019)
    expect(payload.skills).toEqual([
      { name: 'React', proficiencyLevel: 'advanced', isPrimary: true },
    ])
  })

  it('trims the free text rather than storing the spacing', () => {
    const payload = buildProfilePayload('u-1', {
      ...draftFromProfile(FULL, 'Ari'),
      bio: '  Halo  ',
      location: ' Bandung ',
      educationUniversity: ' ITB ',
      educationMajor: ' Informatika ',
    })

    expect(payload).toMatchObject({
      bio: 'Halo',
      location: 'Bandung',
      educationUniversity: 'ITB',
      educationMajor: 'Informatika',
    })
  })

  /**
   * An empty string fails the integer schema and would reject the whole save,
   * so a blank year is omitted instead.
   *
   * This is the one field a talent cannot clear: the write schema types it
   * `number().int().optional()` with no null, and an omitted key reaches
   * Drizzle's `.set()` as undefined, which it filters out - so the stored year
   * stays. Clearing it needs `.nullable()` on the server schema.
   */
  it('omits the graduation year when the field is blank', () => {
    const payload = buildProfilePayload('u-1', {
      ...draftFromProfile(FULL, 'Ari'),
      educationYear: '  ',
    })

    expect(payload.educationYear).toBeUndefined()
  })

  /** Cleared text has to be sent, or the upsert reads it as unchanged. */
  it('sends a cleared bio rather than dropping the key', () => {
    const payload = buildProfilePayload('u-1', { ...draftFromProfile(FULL, 'Ari'), bio: '' })

    expect(payload).toHaveProperty('bio', '')
  })

  it('drops the category, which the write schema does not accept', () => {
    const payload = buildProfilePayload('u-1', draftFromProfile(FULL, 'Ari'))

    expect(payload.skills).not.toContainEqual(expect.objectContaining({ category: 'frontend' }))
  })
})
