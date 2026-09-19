import { AppError, PLATFORM_FEE_BRACKETS } from '@kerjacus/shared'
import { env } from './env'
import { serviceFetch, TIMEOUT_MS } from './http/service-fetch'
import { UpstreamError } from './http/upstream-error'

export type ConvMessage = { role: string; content: string }

type ProjectFields = {
  title: string
  description: string | null
  category: string
  budgetMin: number | null
  budgetMax: number | null
  estimatedTimelineDays: number | null
}

/**
 * The project row reduced to what a prompt is given.
 *
 * Four call sites in routes/projects.ts wrote this same mapping out by hand,
 * so the nullable columns were coalesced in four places and any field added to
 * the prompt had to be added in four.
 */
export function promptFields(project: {
  title: string
  description?: string | null
  category: string
  budgetMin?: number | null
  budgetMax?: number | null
  estimatedTimelineDays?: number | null
}): ProjectFields {
  return {
    title: project.title,
    description: project.description ?? null,
    category: project.category,
    budgetMin: project.budgetMin ?? null,
    budgetMax: project.budgetMax ?? null,
    estimatedTimelineDays: project.estimatedTimelineDays ?? null,
  }
}

type Raw = Record<string, unknown>

type GenerateArgs = {
  projectId: string
  project: ProjectFields
  language: 'id' | 'en'
  currentDocument?: Raw
  revisionInstruction?: string
}

/**
 * BRD and PRD are priced in fixed steps by the project-value level, the same
 * eight levels the fee brackets use, NOT as a percentage. BRD rises Rp 50.000
 * per level (50k at <=3jt up to 400k above 50jt); the PRD is twice the BRD at
 * every level. A project with no AI estimate yet falls in the first level.
 */
const DOC_PRICE_STEP_BRD = 50_000
const DOC_PRICE_STEP_PRD = 100_000

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
export async function generatePrdContent(
  args: GenerateArgs & { brdContent: Raw; conversationHistory: ConvMessage[] },
): Promise<Raw> {
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
          // The prompt asks the model to read this. It was never sent, so the
          // block rendered empty and the PRD saw only the BRD.
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

// Midpoint of the AI's estimated project value, or 0 when it has none yet.
function estimatedProjectValue(content: Raw): number {
  const min = content.estimated_price_min as number | undefined
  const max = content.estimated_price_max as number | undefined
  if (typeof min === 'number' && typeof max === 'number' && min > 0 && max > 0) {
    return (min + max) / 2
  }
  return 0
}

// The project-value level, 0-based, over the same edges as the fee brackets.
// A value at or below a bracket ceiling belongs to that level; above the last
// ceiling is the top level.
function documentPriceLevel(value: number): number {
  let level = 0
  for (const bracket of PLATFORM_FEE_BRACKETS) {
    if (value <= bracket.maxFee) return level
    level++
  }
  return level
}

export function priceBrd(content: Raw): number {
  return (documentPriceLevel(estimatedProjectValue(content)) + 1) * DOC_PRICE_STEP_BRD
}

export function pricePrd(content: Raw): number {
  return (documentPriceLevel(estimatedProjectValue(content)) + 1) * DOC_PRICE_STEP_PRD
}
