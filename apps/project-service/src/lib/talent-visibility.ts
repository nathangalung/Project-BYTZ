import { type getDb, talentEducation, talentProfiles, talentProjects } from '@kerjacus/db'
import { asc, eq } from 'drizzle-orm'

/**
 * What a signed-in caller may read of someone else's talent profile.
 *
 * CLAUDE.md keeps tier and average_rating internal so a client judges on
 * competence rather than reputation, and so a high rating does not compound
 * into more work. cv_parsed_data and cv_file_url are the talent's own personal
 * data. hourly_rate_expectation and pemerataan_penalty are inputs to pricing
 * and to the fairness score, and neither is the caller's business.
 *
 * portfolio_links is withheld until there is a deal. Anonymity before one is
 * partial rather than total - the owner sees the alias, the university and
 * the background, and judges on those - but a GitHub or LinkedIn URL carries
 * the real name and a direct channel. disintermediation.service.ts already
 * treats those two domains as bypass attempts in chat, so serving them from
 * the profile handed over precisely what that filter exists to stop.
 *
 * Bank details are the talent's payout destination and are not in either
 * caller's business. They are withheld from strangers by not being here, and
 * masked even for the talent by maskBankAccount below.
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
  'payoutChannel',
  'payoutProvider',
  'payoutAccountNumber',
  'payoutAccountHolderName',
  'payoutVerifiedAt',
] as const

export function isInternalTalentColumn(column: string): boolean {
  return (INTERNAL_TALENT_COLUMNS as readonly string[]).includes(column)
}

/**
 * The degrees and the projects a stranger may read.
 *
 * Both used to exist only inside the raw CV blob, which is withheld from every
 * external reader, so an owner staffing a position saw a university and a
 * major and nothing else - not the qualification, not a single thing the
 * candidate has actually built. That is precisely what a hiring decision needs,
 * and it is judged on competence, so it belongs here. It is served from the
 * two structured tables; the blob stays withheld, because it also carries the
 * talent's name, email and phone.
 *
 * Two fields are held back, for the reasons the rest of this file already
 * gives.
 *
 * gpa is a grade, and the anonymous candidate card exists so an owner weighs
 * skills and delivery rather than a ranking. It is the same argument that keeps
 * tier and average_rating internal, and the talent reads their own.
 *
 * A project url is a repository or demo link, which is the same object as a
 * portfolio link: it carries the real name and a direct off-platform channel,
 * and disintermediation.service.ts treats those domains as bypass attempts in
 * chat. Withholding portfolio_links from the profile while serving the same
 * GitHub URL under a project title would hand over exactly what that filter
 * exists to stop. The title, the description and the tech stack say what was
 * built without saying who by.
 */
export const PUBLIC_TALENT_EDUCATION_COLUMNS = {
  // The row id, so every list has a stable key. It is a uuidv7 over a degree
  // and says nothing a reader did not already receive.
  id: talentEducation.id,
  university: talentEducation.university,
  degree: talentEducation.degree,
  major: talentEducation.major,
  startYear: talentEducation.startYear,
  endYear: talentEducation.endYear,
} as const

export const PUBLIC_TALENT_PROJECT_COLUMNS = {
  id: talentProjects.id,
  title: talentProjects.title,
  description: talentProjects.description,
  techStack: talentProjects.techStack,
} as const

const OWN_TALENT_EDUCATION_COLUMNS = {
  ...PUBLIC_TALENT_EDUCATION_COLUMNS,
  gpa: talentEducation.gpa,
  pddiktiStatus: talentEducation.pddiktiStatus,
} as const

const OWN_TALENT_PROJECT_COLUMNS = {
  ...PUBLIC_TALENT_PROJECT_COLUMNS,
  url: talentProjects.url,
  linkStatus: talentProjects.linkStatus,
} as const

type Db = ReturnType<typeof getDb>

/**
 * A talent's education, newest first.
 *
 * order_index is the order the CV parse emitted, which the prompt asks for
 * most-recent-first, so it is the sort rather than the years: an entry whose
 * dates the parser could not read still lands where the CV put it.
 */
export async function readTalentEducation(db: Db, talentId: string, own: boolean) {
  return await db
    .select(own ? OWN_TALENT_EDUCATION_COLUMNS : PUBLIC_TALENT_EDUCATION_COLUMNS)
    .from(talentEducation)
    .where(eq(talentEducation.talentId, talentId))
    .orderBy(asc(talentEducation.orderIndex))
}

/** A talent's own projects, in the order the CV listed them. */
export async function readTalentProjects(db: Db, talentId: string, own: boolean) {
  return await db
    .select(own ? OWN_TALENT_PROJECT_COLUMNS : PUBLIC_TALENT_PROJECT_COLUMNS)
    .from(talentProjects)
    .where(eq(talentProjects.talentId, talentId))
    .orderBy(asc(talentProjects.orderIndex))
}

/**
 * Replace a raw account number with its last four digits.
 *
 * The talent reads their own profile in full, which is right for every other
 * column and wrong for this one: a stolen session should not be able to read
 * back an account number, and the last four are enough to recognise which
 * account is on file. Writes still take the whole number.
 *
 * Returns a new object. The caller passes a row, not an entity.
 */
export function maskPayoutAccount<T extends Record<string, unknown>>(
  profile: T,
): Omit<T, 'payoutAccountNumber'> & { payoutAccountLast4: string | null } {
  const { payoutAccountNumber, ...rest } = profile
  const raw = typeof payoutAccountNumber === 'string' ? payoutAccountNumber : null
  return {
    ...rest,
    payoutAccountLast4: raw && raw.length >= 4 ? raw.slice(-4) : null,
  }
}

/**
 * Store one canonical form of an e-wallet phone number.
 *
 * 08123, 628123 and +628123 are the same wallet, and a talent will type
 * whichever their phone shows. Keeping them apart means the same person can
 * hold three different destinations, and the gateway's name check would have to
 * pass three times for one account. Bank numbers are left exactly as given.
 */
export function normalisePayoutAccount(channel: string, account: string): string {
  if (channel !== 'ewallet') return account
  const digits = account.replace(/^\+/, '')
  if (digits.startsWith('0')) return `62${digits.slice(1)}`
  return digits
}
