import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  vector,
} from 'drizzle-orm/pg-core'

// Money columns are `bigint` with `mode: 'number'` (see payment.ts); counts,
// versions, indexes and durations stay `integer`.
import { user } from './better-auth'
import { projects } from './project'

// No userRoleEnum here: user.role is a plain text column (see better-auth.ts),
// and a pgEnum nothing applies is a type that only looks like a constraint.
export const localeEnum = pgEnum('locale', ['id', 'en'])
export const talentTierEnum = pgEnum('talent_tier', ['junior', 'mid', 'senior'])
export const availabilityStatusEnum = pgEnum('availability_status', [
  'available',
  'busy',
  'unavailable',
])
export const verificationStatusEnum = pgEnum('verification_status', [
  'unverified',
  'cv_parsing',
  'verified',
  'suspended',
])
export const proficiencyLevelEnum = pgEnum('proficiency_level', [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
])
export const skillCategoryEnum = pgEnum('skill_category', [
  'frontend',
  'backend',
  'mobile',
  'design',
  'data',
  'devops',
  'other',
])
export const assessmentStageEnum = pgEnum('assessment_stage', ['cv_parsing'])
export const assessmentStatusEnum = pgEnum('assessment_status', [
  'pending',
  'in_progress',
  'passed',
  'failed',
])
export const penaltyTypeEnum = pgEnum('penalty_type', [
  'warning',
  'rating_penalty',
  'suspension',
  'ban',
])
export const appealStatusEnum = pgEnum('appeal_status', ['none', 'pending', 'accepted', 'rejected'])

export const talentProfiles = pgTable(
  'talent_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id),
    bio: text('bio'),
    yearsOfExperience: integer('years_of_experience').notNull().default(0),
    tier: talentTierEnum('tier').notNull().default('junior'),
    educationUniversity: varchar('education_university', { length: 255 }),
    educationMajor: varchar('education_major', { length: 255 }),
    educationYear: integer('education_year'),
    cvFileUrl: text('cv_file_url'),
    cvParsedData: jsonb('cv_parsed_data'),
    portfolioLinks: jsonb('portfolio_links'),
    hourlyRateExpectation: bigint('hourly_rate_expectation', { mode: 'number' }),
    // Payout destination. Never in PUBLIC_TALENT_COLUMNS, and masked to the
    // last four digits even for the talent, so a stolen session cannot harvest
    // account numbers. Not bank-only: Midtrans and Xendit disburse
    // to e-wallets under the same shape, a provider code plus an account
    // identifier, so payout_channel is what decides how the number is read --
    // digits for a bank, the registered phone for an e-wallet.
    // payout_verified_at gates disbursement; null means never pay this out.
    payoutChannel: varchar('payout_channel', { length: 10 }),
    payoutProvider: varchar('payout_provider', { length: 20 }),
    payoutAccountNumber: varchar('payout_account_number', { length: 34 }),
    payoutAccountHolderName: varchar('payout_account_holder_name', { length: 255 }),
    payoutVerifiedAt: timestamp('payout_verified_at', { withTimezone: true }),
    location: varchar('location', { length: 255 }),
    availabilityStatus: availabilityStatusEnum('availability_status')
      .default('available')
      .notNull(),
    verificationStatus: verificationStatusEnum('verification_status')
      .default('unverified')
      .notNull(),
    domainExpertise: jsonb('domain_expertise'),
    totalProjectsCompleted: integer('total_projects_completed').default(0).notNull(),
    totalProjectsActive: integer('total_projects_active').default(0).notNull(),
    averageRating: real('average_rating'),
    pemerataanPenalty: real('pemerataan_penalty').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // The candidate filter in findEligibleTalents. user_id needs nothing extra:
  // .unique() already backs it with an index.
  (table) => [
    index('idx_talent_profiles_eligible').on(table.verificationStatus, table.availabilityStatus),
  ],
)

export const skills = pgTable('skills', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  category: skillCategoryEnum('category').notNull(),
  aliases: jsonb('aliases'),
  embedding: vector('embedding', { dimensions: 1024 }),
})

export const talentSkills = pgTable(
  'talent_skills',
  {
    talentId: text('talent_id')
      .notNull()
      .references(() => talentProfiles.id),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id),
    proficiencyLevel: proficiencyLevelEnum('proficiency_level').notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
  },
  (table) => [uniqueIndex('talent_skills_pk').on(table.talentId, table.skillId)],
)

/**
 * A talent's degrees, one row each.
 *
 * The CV parse already returns every entry with university, degree, major, gpa
 * and both years, and all of it was being thrown into a jsonb blob nobody may
 * read. The three flat columns on talent_profiles hold one degree and drop the
 * qualification and the grade, so an S1 + S2 talent lost half their education
 * the moment it was stored.
 *
 * order_index preserves the order the parse emitted, which is most recent
 * first; it is not a sort key to be recomputed.
 *
 * pddikti_status and pddikti_checked_at are the seats for the advisory check
 * against the national higher-education register. Nothing writes them yet.
 * They are tri-state on purpose -- 'unverified', 'found', 'not_found' -- so an
 * outage reads as "not checked" rather than "fake", and the verdict stays
 * advisory: verification_status is not derived from it.
 */
export const talentEducation = pgTable(
  'talent_education',
  {
    id: text('id').primaryKey(),
    talentId: text('talent_id')
      .notNull()
      .references(() => talentProfiles.id),
    university: varchar('university', { length: 255 }).notNull(),
    degree: varchar('degree', { length: 100 }),
    major: varchar('major', { length: 255 }),
    // Free text, not numeric: a CV writes "3.72", "3,72/4.00" or "cum laude",
    // and coercing that to a number either fails the write or invents a grade.
    gpa: varchar('gpa', { length: 20 }),
    startYear: integer('start_year'),
    endYear: integer('end_year'),
    orderIndex: integer('order_index').notNull().default(0),
    pddiktiStatus: varchar('pddikti_status', { length: 20 }),
    pddiktiCheckedAt: timestamp('pddikti_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Always read as "this talent's education", never across talents.
  (table) => [index('idx_talent_education_talent').on(table.talentId)],
)

/**
 * A talent's own projects, one row each.
 *
 * The parse returns title, description, tech stack and a URL per project, and
 * registration reduced all of it to a bare link in portfolio_links. Title,
 * description and tech stack -- the only part an owner can judge competence on
 * -- were dropped, so nobody outside the CV blob ever saw them.
 *
 * link_status and link_checked_at are the seats for the existence check on the
 * URL. Nothing writes them yet. Tri-state for the same reason as above: a
 * timed-out host is 'unchecked', not 'unreachable'.
 */
export const talentProjects = pgTable(
  'talent_projects',
  {
    id: text('id').primaryKey(),
    talentId: text('talent_id')
      .notNull()
      .references(() => talentProfiles.id),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    // jsonb rather than text[]: every other list in this schema is jsonb
    // (skills.aliases, work_packages.required_skills) and one array type is
    // cheaper to read than two.
    techStack: jsonb('tech_stack').$type<string[]>(),
    url: text('url'),
    orderIndex: integer('order_index').notNull().default(0),
    linkStatus: varchar('link_status', { length: 20 }),
    linkCheckedAt: timestamp('link_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_talent_projects_talent').on(table.talentId)],
)

export const talentAssessments = pgTable('talent_assessments', {
  id: text('id').primaryKey(),
  talentId: text('talent_id')
    .notNull()
    .references(() => talentProfiles.id),
  stage: assessmentStageEnum('stage').notNull(),
  status: assessmentStatusEnum('status').notNull().default('pending'),
  score: real('score'),
  reviewerId: text('reviewer_id').references(() => user.id),
  notes: text('notes'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const phoneVerifications = pgTable('phone_verifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  phone: varchar('phone', { length: 20 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verified: boolean('verified').default(false).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const talentPenalties = pgTable('talent_penalties', {
  id: text('id').primaryKey(),
  talentId: text('talent_id')
    .notNull()
    .references(() => talentProfiles.id),
  type: penaltyTypeEnum('type').notNull(),
  reason: text('reason').notNull(),
  // The penalty is issued over a specific engagement, so the reference has to
  // hold. It was a bare text column, and admin-service reads it back to show
  // the admin which project a suspension came from.
  relatedProjectId: text('related_project_id').references(() => projects.id),
  issuedBy: text('issued_by')
    .notNull()
    .references(() => user.id),
  appealStatus: appealStatusEnum('appeal_status').default('none').notNull(),
  appealNote: text('appeal_note'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
