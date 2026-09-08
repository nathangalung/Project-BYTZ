/**
 * Scoping chat context helpers.
 *
 * Form fields the client fills before opening the chatbot are not surfaced to
 * the AI by default. These helpers build a system-message preamble from the
 * project row (so the model can answer in context) and a completeness floor
 * (so the percentage reflects information already collected via the form).
 *
 * The keys and keywords come from packages/shared, and ai-service scores the
 * transcript against a Python copy generated from that same file, so the two
 * surfaces cannot drift. Final score = max(form_floor, ai_score).
 */

import {
  COMPLETENESS_KEYS,
  COMPLETENESS_KEYWORDS,
  type CompletenessKey,
  DESCRIPTION_MIN_CHARS,
  REQUIREMENTS_MIN_CHARS,
} from '@kerjacus/shared'

export type ProjectFormFields = {
  title: string
  description: string
  category: string
  budgetMin: number
  budgetMax: number
  estimatedTimelineDays: number
  preferences: unknown
}

type Preferences = {
  industry?: string
  problem?: string
  targetUsers?: string
  mainFeatures?: string
  budgetRange?: string
  deadlineRange?: string
  platforms?: string[]
  requiredSkills?: string[]
  minExperience?: number
  almamater?: string
}

function preferences(project: ProjectFormFields): Preferences {
  return (project.preferences ?? {}) as Preferences
}

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString('id-ID')}`
}

export function buildScopingSystemPrompt(project: ProjectFormFields): string {
  const prefs = preferences(project)
  const lines: string[] = [
    'You are a project scoping assistant for KerjaCUS!, an Indonesian managed marketplace for digital projects.',
    'Reply in Bahasa Indonesia by default. Use short, focused follow-up questions to fill gaps in the BRD template.',
    '',
    'The client has already provided the following via the intake form. Use it as ground truth — do NOT re-ask for these fields. Build on them with sharper questions.',
    '',
    `Project title: ${project.title}`,
    `Category: ${project.category}`,
    `Budget: ${formatRupiah(project.budgetMin)} - ${formatRupiah(project.budgetMax)}`,
    `Timeline: ${project.estimatedTimelineDays} days`,
    `Description: ${project.description}`,
  ]

  if (prefs.problem) lines.push(`Problem statement: ${prefs.problem}`)
  if (prefs.targetUsers) lines.push(`Target users: ${prefs.targetUsers}`)
  if (prefs.mainFeatures) lines.push(`Main features: ${prefs.mainFeatures}`)
  if (prefs.industry) lines.push(`Industry: ${prefs.industry}`)
  if (prefs.platforms?.length) lines.push(`Platforms: ${prefs.platforms.join(', ')}`)
  if (prefs.requiredSkills?.length)
    lines.push(`Required skills: ${prefs.requiredSkills.join(', ')}`)
  if (typeof prefs.minExperience === 'number') {
    lines.push(`Minimum talent experience: ${prefs.minExperience} years`)
  }

  lines.push('')
  lines.push(
    'Ask follow-ups about: success metrics, business objectives, risks/constraints, integrations, out-of-scope items, stakeholder roles. One concise question at a time.',
  )

  return lines.join('\n')
}

function anyMatch(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w))
}

type FormCompleteness = {
  floor: number
  missing: string[]
}

/** The form as one lowercased string, plus the fields that answer outright. */
function formSignals(project: ProjectFormFields): {
  text: string
  answered: Partial<Record<CompletenessKey, boolean>>
} {
  const prefs = preferences(project)
  const text = [
    project.title,
    project.description,
    project.category,
    project.budgetMin > 0 ? `Rp ${project.budgetMin}` : '',
    project.budgetMax > 0 ? `Rp ${project.budgetMax}` : '',
    project.estimatedTimelineDays > 0 ? `${project.estimatedTimelineDays} hari timeline` : '',
    prefs.problem ?? '',
    prefs.targetUsers ?? '',
    prefs.mainFeatures ?? '',
    prefs.industry ?? '',
    prefs.budgetRange ?? '',
    prefs.deadlineRange ?? '',
    (prefs.platforms ?? []).join(' '),
    (prefs.requiredSkills ?? []).join(' '),
  ]
    .join(' ')
    .toLowerCase()

  // A filled budget or timeline field answers its section outright. The words
  // only matter when the owner wrote the figure into free text instead.
  const answered: Partial<Record<CompletenessKey, boolean>> = {
    budget: project.budgetMin > 0 || project.budgetMax > 0,
    timeline: project.estimatedTimelineDays > 0,
  }

  return { text, answered }
}

/**
 * Score the intake form plus what the owner said in chat, and name the gaps.
 *
 * The keys match the AI scorer's _completeness_checks and the missing_* i18n
 * labels one for one, so the chips, the assistant's opening question and the
 * chat's own scoring all describe the same gaps.
 *
 * The bar used to be `Math.max(formFloor, aiScore)` at send time and the bare
 * form floor on reload, because nothing wrote the chat's score anywhere: the
 * `completeness_score` column has one reader and no writer. So an owner who
 * reached 91 percent through the conversation came back to whatever the form
 * alone was worth, which is the progress bar appearing not to move.
 *
 * Deriving it from both texts fixes that without a column to keep in sync, and
 * it is never lower than the old maximum: every check is an independent OR over
 * the words, so a section covered by either source is covered by the union.
 * `health_score` and `pemerataan_skor` are derived for the same reason.
 */
export function computeScopingCompleteness(
  project: ProjectFormFields,
  ownerMessages: readonly string[],
): FormCompleteness {
  const { text: formText, answered } = formSignals(project)
  const combined = [formText, ...ownerMessages.map((m) => m.toLowerCase())].join(' ')
  return scoreText(combined, answered)
}

/** One pass over the eleven checks the BRD template needs. */
function scoreText(
  text: string,
  answered: Partial<Record<CompletenessKey, boolean>>,
): FormCompleteness {
  const entries: [string, boolean][] = COMPLETENESS_KEYS.map((key) => {
    if (key === 'description') return [key, text.length > DESCRIPTION_MIN_CHARS]
    const matched = anyMatch(text, COMPLETENESS_KEYWORDS[key])
    if (key === 'requirements') {
      return [key, text.length > REQUIREMENTS_MIN_CHARS && matched]
    }
    return [key, answered[key] === true || matched]
  })
  const passed = entries.filter(([, ok]) => ok).length
  return {
    floor: Math.min(100, Math.round((passed / entries.length) * 100)),
    missing: entries.filter(([, ok]) => !ok).map(([key]) => key),
  }
}
