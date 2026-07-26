import { ProjectVisibility } from '@kerjacus/shared'
import { ClipboardList, FileText, Settings, Wallet } from 'lucide-react'
import { z } from 'zod'

/**
 * What the project intake wizard is made of.
 *
 * The wizard was one 1635-line module: nine components with their shared
 * types, constants and validation. The components were already separate
 * functions - they just had nowhere to live, so none could be read or
 * changed without loading the whole intake flow.
 */

export type SelectedPath = null | 'A' | 'B'
export type DocumentType = '' | 'brd' | 'prd' | 'both'

export type FormData = {
  title: string
  description: string
  category: string
  budgetMin: string
  budgetMax: string
  estimatedTimelineDays: string
  deadline: string
  almamater: string
  minExperience: string
  requiredSkills: string[]
  visibility: ProjectVisibility
  documentFileKey: string
  documentType: DocumentType
}

/** Path B: the owner has no brief yet and answers guided questions instead. */
export type BriefFormData = {
  title: string
  industry: string
  problem: string
  targetUsers: string
  mainFeatures: string
  budgetRange: string
  deadlineRange: string
  platforms: string[]
}

export const STEPS = [
  { key: 'basic_info', icon: FileText },
  { key: 'budget_timeline', icon: Wallet },
  { key: 'preferences', icon: Settings },
  { key: 'review_submit', icon: ClipboardList },
] as const

export const CATEGORIES = [
  'web_app',
  'mobile_app',
  'ui_ux_design',
  'data_ai',
  'other_digital',
] as const

export const BUDGET_RANGES = [
  'budget_not_decided',
  'budget_under_20m',
  'budget_20_50m',
  'budget_50_150m',
  'budget_over_150m',
] as const

export const DEADLINE_RANGES = [
  'deadline_flexible',
  'deadline_1_2_months',
  'deadline_2_4_months',
  'deadline_4_6_months',
  'deadline_over_6_months',
] as const

export const PLATFORM_OPTIONS = [
  'Web App',
  'Mobile (iOS)',
  'Mobile (Android)',
  'Desktop',
  'API / Backend',
] as const

export const VISIBILITY_OPTIONS = [
  {
    value: ProjectVisibility.PUBLIC_DETAIL,
    labelKey: 'vis_public_full',
    descKey: 'vis_public_full_desc',
  },
  {
    value: ProjectVisibility.PUBLIC_SUMMARY,
    labelKey: 'vis_public_summary',
    descKey: 'vis_public_summary_desc',
  },
  { value: ProjectVisibility.PRIVATE, labelKey: 'vis_private', descKey: 'vis_private_desc' },
] as const

export const step1Schema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  category: z.enum(['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other_digital']),
})

export const step2Schema = z.object({
  budgetMin: z
    .string()
    .min(1)
    .refine((v) => Number(v.replace(/\D/g, '')) > 0, {
      message: 'Budget minimum must be positive',
    }),
  budgetMax: z
    .string()
    .min(1)
    .refine((v) => Number(v.replace(/\D/g, '')) > 0, {
      message: 'Budget maximum must be positive',
    }),
  estimatedTimelineDays: z
    .string()
    .min(1)
    .refine((v) => Number(v) > 0, {
      message: 'Timeline must be positive',
    }),
})

/** Budget is typed with thousands separators; the API wants a number. */
export function parseBudget(raw: string): number {
  return Number(raw.replace(/\D/g, '')) || 0
}

export function formatBudgetInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('id-ID')
}

export const INPUT_BASE =
  'w-full rounded-lg border bg-surface-container px-3 py-2.5 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 transition-colors'
export const INPUT_NORMAL =
  'border-outline-dim/30 focus:border-primary-500 focus:ring-primary-500/30'
export const INPUT_ERROR = 'border-error-500 focus:border-error-500 focus:ring-error-500'

// Exported so the request body stays under test.
export function buildCreateProjectPayload(
  form: FormData,
  company?: { projectType: 'individual' | 'company'; companyName: string; companyRole: string },
): Record<string, unknown> {
  const preferences: Record<string, unknown> = {}
  if (form.almamater) preferences.almamater = form.almamater
  if (form.minExperience) preferences.minExperience = Number(form.minExperience)
  if (form.requiredSkills.length > 0) preferences.requiredSkills = form.requiredSkills
  // Company owner info was collected but never sent.
  if (company?.projectType === 'company') {
    if (company.companyName.trim()) preferences.companyName = company.companyName.trim()
    if (company.companyRole.trim()) preferences.companyRole = company.companyRole.trim()
  }

  return {
    title: form.title,
    description: form.description,
    category: form.category,
    budgetMin: parseBudget(form.budgetMin),
    budgetMax: parseBudget(form.budgetMax),
    estimatedTimelineDays: Number(form.estimatedTimelineDays),
    visibility: form.visibility,
    preferences: Object.keys(preferences).length > 0 ? preferences : undefined,
  }
}
