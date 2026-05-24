/**
 * Scoping chat context helpers.
 *
 * Form fields the client fills before opening the chatbot are not surfaced to
 * the AI by default. These helpers build a system-message preamble from the
 * project row (so the model can answer in context) and a completeness floor
 * (so the percentage reflects information already collected via the form).
 *
 * The completeness floor mirrors ai-service `calculate_completeness` keyword
 * checks so the two surfaces agree. Final score = max(form_floor, ai_score).
 */

type ProjectFormFields = {
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

const KEYWORDS = {
  problem: [
    'masalah',
    'problem',
    'kendala',
    'pain',
    'isu',
    'issue',
    'saat ini',
    'currently',
    'manual',
    'tidak bisa',
    'belum ada',
  ],
  objectives: [
    'tujuan',
    'goal',
    'objective',
    'target',
    'ingin',
    'mau',
    'want',
    'meningkatkan',
    'increase',
    'menurunkan',
    'reduce',
  ],
  features: [
    'fitur',
    'feature',
    'fungsi',
    'function',
    'modul',
    'module',
    'halaman',
    'page',
    'dashboard',
    'login',
    'register',
  ],
  users: [
    'user',
    'pengguna',
    'pelanggan',
    'customer',
    'target',
    'audience',
    'admin',
    'konsumen',
    'pembeli',
    'buyer',
  ],
  requirements: [
    'harus',
    'must',
    'perlu',
    'need',
    'require',
    'wajib',
    'sistem',
    'system',
    'data',
    'laporan',
    'report',
  ],
  risks: [
    'risiko',
    'risk',
    'asumsi',
    'assumption',
    'keterbatasan',
    'constraint',
    'tantangan',
    'challenge',
    'hambatan',
  ],
  metrics: [
    'metrik',
    'metric',
    'kpi',
    'ukur',
    'measure',
    'sukses',
    'success',
    'persentase',
    'percent',
    'angka',
    'number',
    'target',
  ],
  budget: ['budget', 'biaya', 'harga', 'anggaran', 'rp', 'juta', 'ribu', 'million', 'cost', 'dana'],
  timeline: [
    'deadline',
    'waktu',
    'timeline',
    'kapan',
    'bulan',
    'minggu',
    'hari',
    'day',
    'week',
    'month',
    'selesai',
    'launch',
  ],
  integrations: [
    'integrasi',
    'integration',
    'api',
    'payment',
    'pembayaran',
    'whatsapp',
    'google',
    'midtrans',
    'xendit',
    'notifikasi',
  ],
} as const

function anyMatch(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w))
}

export function computeFormCompletenessFloor(project: ProjectFormFields): number {
  const prefs = preferences(project)
  const formText = [
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

  const checks = [
    formText.length > 80, // executive summary substance
    anyMatch(formText, KEYWORDS.problem),
    anyMatch(formText, KEYWORDS.objectives),
    anyMatch(formText, KEYWORDS.features),
    anyMatch(formText, KEYWORDS.users),
    formText.length > 300 && anyMatch(formText, KEYWORDS.requirements),
    anyMatch(formText, KEYWORDS.risks),
    anyMatch(formText, KEYWORDS.metrics),
    project.budgetMin > 0 || project.budgetMax > 0 || anyMatch(formText, KEYWORDS.budget),
    project.estimatedTimelineDays > 0 || anyMatch(formText, KEYWORDS.timeline),
    anyMatch(formText, KEYWORDS.integrations),
  ]

  const passed = checks.filter(Boolean).length
  return Math.min(100, Math.round((passed / checks.length) * 100))
}
