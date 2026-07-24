import { env } from './env'
import { withServiceAuth } from './service-auth'

type ConvMessage = { role: string; content: string }

type ProjectFields = {
  title: string
  description: string | null
  category: string
  budgetMin: number | null
  budgetMax: number | null
  estimatedTimelineDays: number | null
}

type Raw = Record<string, unknown>

type GenerateArgs = {
  projectId: string
  project: ProjectFields
  language: 'id' | 'en'
  currentDocument?: Raw
  revisionInstruction?: string
}

const DEFAULT_BRD_PRICE = 99_000
const DEFAULT_PRD_PRICE = 199_000

// Pull the document body out of either response envelope.
function unwrap(aiResponse: Record<string, Raw>, key: string): Raw {
  return (aiResponse[key] ?? (aiResponse.data as Raw)?.[key] ?? {}) as Raw
}

// AI call plus fallback; returns stored-shape BRD content.
export async function generateBrdContent(
  args: GenerateArgs & { conversationHistory: ConvMessage[] },
): Promise<Raw> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/api/v1/ai/generate-brd`, {
      method: 'POST',
      headers: withServiceAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        project_id: args.projectId,
        conversation_history: args.conversationHistory,
        project_category: args.project.category,
        budget_min: args.project.budgetMin,
        budget_max: args.project.budgetMax,
        timeline_days: args.project.estimatedTimelineDays,
        language: args.language,
        current_document: args.currentDocument ?? {},
        revision_instruction: args.revisionInstruction ?? '',
      }),
    })
    if (res.ok) {
      const aiResponse = (await res.json()) as Record<string, Raw>
      let brd = unwrap(aiResponse, 'brd')
      const templateScore = aiResponse.template_score ?? (aiResponse.data as Raw)?.template_score
      if (templateScore) brd = { ...brd, template_score: templateScore }
      return brd
    }
  } catch {
    // Fall through to a minimal document.
  }
  return {
    executive_summary: `Proyek ${args.project.title}: ${args.project.description?.substring(0, 300) ?? ''}`,
    business_objectives: ['Selesaikan proyek sesuai kebutuhan'],
    scope: args.project.description ?? '',
  }
}

// AI call plus fallback; returns stored-shape PRD content.
export async function generatePrdContent(args: GenerateArgs & { brdContent: Raw }): Promise<Raw> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/api/v1/ai/generate-prd`, {
      method: 'POST',
      headers: withServiceAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        project_id: args.projectId,
        brd_content: args.brdContent,
        project_category: args.project.category,
        budget_min: args.project.budgetMin,
        budget_max: args.project.budgetMax,
        timeline_days: args.project.estimatedTimelineDays,
        language: args.language,
        current_document: args.currentDocument ?? {},
        revision_instruction: args.revisionInstruction ?? '',
      }),
    })
    if (res.ok) {
      const aiResponse = (await res.json()) as Record<string, Raw>
      return unwrap(aiResponse, 'prd')
    }
  } catch {
    // Fall through to a minimal document.
  }
  return { tech_stack: [], architecture: 'Standard web architecture', api_design: [] }
}

// Price a document from its AI estimate, floored at the default.
function priceDocument(content: Raw, factor: number, floor: number): number {
  const min = content.estimated_price_min as number | undefined
  const max = content.estimated_price_max as number | undefined
  if (typeof min === 'number' && typeof max === 'number' && min > 0 && max > 0) {
    const price = Math.round(((min + max) / 2) * factor)
    return price < floor ? floor : price
  }
  return floor
}

export function priceBrd(content: Raw): number {
  return priceDocument(content, 0.05, DEFAULT_BRD_PRICE)
}

export function pricePrd(content: Raw): number {
  return priceDocument(content, 0.08, DEFAULT_PRD_PRICE)
}
