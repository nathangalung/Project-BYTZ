import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './better-auth'

export const userRoleEnum = pgEnum('user_role', ['owner', 'talent', 'admin'])
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

export const talentProfiles = pgTable('talent_profiles', {
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
  hourlyRateExpectation: integer('hourly_rate_expectation'),
  availabilityStatus: availabilityStatusEnum('availability_status').default('available').notNull(),
  verificationStatus: verificationStatusEnum('verification_status').default('unverified').notNull(),
  domainExpertise: jsonb('domain_expertise'),
  totalProjectsCompleted: integer('total_projects_completed').default(0).notNull(),
  totalProjectsActive: integer('total_projects_active').default(0).notNull(),
  averageRating: real('average_rating'),
  pemerataanPenalty: real('pemerataan_penalty').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const skills = pgTable('skills', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  category: skillCategoryEnum('category').notNull(),
  aliases: jsonb('aliases'),
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
  relatedProjectId: text('related_project_id'),
  issuedBy: text('issued_by')
    .notNull()
    .references(() => user.id),
  appealStatus: appealStatusEnum('appeal_status').default('none').notNull(),
  appealNote: text('appeal_note'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
