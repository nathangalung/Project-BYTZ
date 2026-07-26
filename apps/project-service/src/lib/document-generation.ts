import { AppError } from '@kerjacus/shared'
import { env } from './env'
import { serviceFetch, TIMEOUT_MS } from './http/service-fetch'
import { UpstreamError } from './http/upstream-error'

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

/**
 * Refuse to stand in for the model.
 *
 * Both generators used to swallow every failure and return a stub built from
 * the project description. The route stores whatever comes back, and the free
 * tier counts stored rows, so a failed generation still looked like a document
 * and still spent the owner's one free document for the day. Raising here
 * keeps the row unwritten, which is what leaves the quota alone.
 */
/**
 * Describe why the call failed, for the operator-facing reason string.
 *
 * serviceFetch turns a non-2xx into an UpstreamError, so the old `HTTP ${status}`
 * branch after the try block is now unreachable - the status arrives here instead.
 */
function describeUpstream(err: unknown): string {
  if (err instanceof UpstreamError) {
    return err.status === null ? (err.detail ?? 'request failed') : `HTTP ${err.status}`
  }
  return err instanceof Error ? err.message : 'request failed'
}

function unavailable(kind: string, reason: string): never {
  throw new AppError(
    'AI_SERVICE_UNAVAILABLE',
    `Could not generate the ${kind}: the AI service is unavailable (${reason}). Nothing was saved and your daily quota is untouched. Please try again.`,
  )
}

// Calls the AI service; throws rather than inventing a document.
export async function generateBrdContent(
  args: GenerateArgs & { conversationHistory: ConvMessage[] },
): Promise<Raw> {
  let res: Response
  try {
    res = await serviceFetch(
      `${env.AI_SERVICE_URL}/api/v1/ai/generate-brd`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      },
      // No retry: generation is not idempotent, so a retry is a second billed
      // Gemini call that also burns a slot in the owner's daily free quota.
      { service: 'ai-service', timeoutMs: TIMEOUT_MS.document },
    )
  } catch (err) {
    unavailable('BRD', describeUpstream(err))
  }

  const aiResponse = (await res.json()) as Record<string, Raw>
  let brd = unwrap(aiResponse, 'brd')
  if (Object.keys(brd).length === 0) unavailable('BRD', 'empty document')
  const templateScore = aiResponse.template_score ?? (aiResponse.data as Raw)?.template_score
  if (templateScore) brd = { ...brd, template_score: templateScore }
  return brd
}

// Calls the AI service; throws rather than inventing a document.
export async function generatePrdContent(args: GenerateArgs & { brdContent: Raw }): Promise<Raw> {
  let res: Response
  try {
    res = await serviceFetch(
      `${env.AI_SERVICE_URL}/api/v1/ai/generate-prd`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      },
      // Not idempotent - see generateBrdContent.
      { service: 'ai-service', timeoutMs: TIMEOUT_MS.document },
    )
  } catch (err) {
    unavailable('PRD', describeUpstream(err))
  }

  const aiResponse = (await res.json()) as Record<string, Raw>
  const prd = unwrap(aiResponse, 'prd')
  if (Object.keys(prd).length === 0) unavailable('PRD', 'empty document')
  return prd
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
