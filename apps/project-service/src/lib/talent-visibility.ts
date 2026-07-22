import { talentProfiles } from '@kerjacus/db'

/**
 * What a signed-in caller may read of someone else's talent profile.
 *
 * CLAUDE.md keeps tier and average_rating internal so a client judges on
 * competence rather than reputation, and so a high rating does not compound
 * into more work. cv_parsed_data and cv_file_url are the talent's own personal
 * data. hourly_rate_expectation and pemerataan_penalty are inputs to pricing
 * and to the fairness score, and neither is the caller's business.
 *
 * What is left is what the matching screen actually shows.
 */
export const PUBLIC_TALENT_COLUMNS = {
  id: talentProfiles.id,
  userId: talentProfiles.userId,
  bio: talentProfiles.bio,
  yearsOfExperience: talentProfiles.yearsOfExperience,
  educationUniversity: talentProfiles.educationUniversity,
  educationMajor: talentProfiles.educationMajor,
  educationYear: talentProfiles.educationYear,
  portfolioLinks: talentProfiles.portfolioLinks,
  domainExpertise: talentProfiles.domainExpertise,
  availabilityStatus: talentProfiles.availabilityStatus,
  verificationStatus: talentProfiles.verificationStatus,
  totalProjectsCompleted: talentProfiles.totalProjectsCompleted,
} as const

const INTERNAL_TALENT_COLUMNS = [
  'tier',
  'averageRating',
  'cvParsedData',
  'cvFileUrl',
  'hourlyRateExpectation',
  'pemerataanPenalty',
  'location',
  'totalProjectsActive',
] as const

export function isInternalTalentColumn(column: string): boolean {
  return (INTERNAL_TALENT_COLUMNS as readonly string[]).includes(column)
}
