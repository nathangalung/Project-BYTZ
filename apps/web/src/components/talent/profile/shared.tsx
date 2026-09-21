import { useQuery } from '@tanstack/react-query'
import { Github, Globe, Linkedin, Palette } from 'lucide-react'
import { apiUrl } from '@/lib/api'

export type TalentProfile = {
  id: string
  userId: string
  bio: string
  yearsOfExperience: number
  tier: 'junior' | 'mid' | 'senior'
  educationUniversity: string | null
  educationMajor: string | null
  educationYear: number | null
  location: string | null
  cvFileUrl: string | null
  portfolioLinks: { platform: string; url: string }[]
  availabilityStatus: 'available' | 'busy' | 'unavailable'
  verificationStatus: 'unverified' | 'cv_parsing' | 'verified' | 'suspended'
  domainExpertise: string[]
  totalProjectsCompleted: number
  totalProjectsActive: number
  averageRating: number | null
  skills: {
    name: string
    category: string
    proficiencyLevel: string
    isPrimary: boolean
  }[]
}

export type ReviewItem = {
  id: string
  projectId: string
  rating: number
  comment: string
  createdAt: string
}

export function useTalentRatings() {
  return useQuery({
    queryKey: ['talent-ratings'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/v1/talents/ratings'), {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load ratings')
      const data = await res.json()
      return (data.data ?? []) as ReviewItem[]
    },
  })
}

export const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  GitHub: <Github className="h-4 w-4" />,
  LinkedIn: <Linkedin className="h-4 w-4" />,
  Dribbble: <Palette className="h-4 w-4" />,
  Behance: <Palette className="h-4 w-4" />,
  Website: <Globe className="h-4 w-4" />,
}

export const VERIFICATION_COLORS: Record<string, string> = {
  verified: 'bg-success-500/10 text-success-600',
  cv_parsing: 'bg-warning-500/10 text-warning-600',
  unverified: 'bg-surface-container text-on-surface-muted',
  suspended: 'bg-error-500/10 text-error-600',
}

export const PROFICIENCY_COLORS: Record<string, string> = {
  beginner: 'bg-surface-container text-on-surface-muted',
  intermediate: 'bg-brand-accent/15 text-brand-text',
  advanced: 'bg-success-500/10 text-success-600',
  expert: 'bg-accent-coral-500/10 text-accent-coral-600',
}

export const SKILL_CATEGORY_ORDER = [
  'frontend',
  'backend',
  'mobile',
  'design',
  'data',
  'devops',
  'other',
]

export const PROFICIENCY_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number]

/** The API types proficiency as a free string; the write schema does not. */
export function toProficiencyLevel(value: string): ProficiencyLevel {
  return (PROFICIENCY_LEVELS as readonly string[]).includes(value)
    ? (value as ProficiencyLevel)
    : 'intermediate'
}

/**
 * The pieces a complete talent profile is made of.
 *
 * Kept as data rather than as JSX conditionals so the percentage and the
 * "still missing" list come from one place, and so the rule can be tested
 * without rendering anything.
 */
export const COMPLETENESS_FIELDS = [
  'bio',
  'experience',
  'education',
  'skills',
  'portfolio',
  'domain',
  'cv',
] as const

export type CompletenessField = (typeof COMPLETENESS_FIELDS)[number]

export function profileCompleteness(profile: TalentProfile): {
  percent: number
  missing: CompletenessField[]
} {
  const filled: Record<CompletenessField, boolean> = {
    bio: Boolean(profile.bio?.trim()),
    experience: profile.yearsOfExperience > 0,
    education: Boolean(
      profile.educationUniversity || profile.educationMajor || profile.educationYear,
    ),
    skills: (profile.skills ?? []).length > 0,
    portfolio: (profile.portfolioLinks ?? []).length > 0,
    domain: (profile.domainExpertise ?? []).length > 0,
    cv: Boolean(profile.cvFileUrl),
  }
  const missing = COMPLETENESS_FIELDS.filter((field) => !filled[field])
  const done = COMPLETENESS_FIELDS.length - missing.length
  return { percent: Math.round((done / COMPLETENESS_FIELDS.length) * 100), missing }
}

export type ProfileDraft = {
  name: string
  bio: string
  yearsOfExperience: string
  location: string
  educationUniversity: string
  educationMajor: string
  educationYear: string
  skills: {
    name: string
    category: string
    proficiencyLevel: ProficiencyLevel
    isPrimary: boolean
  }[]
  portfolioLinks: { platform: string; url: string }[]
  domainExpertise: string[]
}

export function draftFromProfile(profile: TalentProfile, name: string): ProfileDraft {
  return {
    name,
    bio: profile.bio ?? '',
    yearsOfExperience: String(profile.yearsOfExperience),
    location: profile.location ?? '',
    educationUniversity: profile.educationUniversity ?? '',
    educationMajor: profile.educationMajor ?? '',
    educationYear: profile.educationYear ? String(profile.educationYear) : '',
    skills: (profile.skills ?? []).map((s) => ({
      name: s.name,
      category: s.category,
      proficiencyLevel: toProficiencyLevel(s.proficiencyLevel),
      isPrimary: s.isPrimary,
    })),
    portfolioLinks: [...(profile.portfolioLinks ?? [])],
    domainExpertise: [...(profile.domainExpertise ?? [])],
  }
}

/**
 * The i18n key of the first rule the draft breaks, or null.
 *
 * Skills are required because the write path treats an empty list as "leave
 * the skills alone" -- clearing them all would report success and change
 * nothing, and a talent with no skills is not matchable either way.
 */
export function validateProfileDraft(draft: ProfileDraft): string | null {
  if (draft.name.trim().length < 2) return 'name_required'
  const years = Number(draft.yearsOfExperience)
  if (!draft.yearsOfExperience.trim() || !Number.isInteger(years) || years < 0) {
    return 'experience_invalid'
  }
  if (draft.skills.length === 0) return 'skills_required'
  return null
}

/**
 * The POST /talent-profiles body.
 *
 * Every editable field is sent every time: the write is an upsert over the
 * whole row, and a field left out would be read as unchanged, so a cleared
 * bio would silently come back.
 */
export function buildProfilePayload(userId: string, draft: ProfileDraft): Record<string, unknown> {
  return {
    userId,
    yearsOfExperience: Number(draft.yearsOfExperience),
    bio: draft.bio.trim(),
    location: draft.location.trim(),
    educationUniversity: draft.educationUniversity.trim(),
    educationMajor: draft.educationMajor.trim(),
    educationYear: draft.educationYear.trim() ? Number(draft.educationYear) : undefined,
    skills: draft.skills.map((s) => ({
      name: s.name,
      proficiencyLevel: s.proficiencyLevel,
      isPrimary: s.isPrimary,
    })),
    portfolioLinks: draft.portfolioLinks,
    domainExpertise: draft.domainExpertise,
  }
}
