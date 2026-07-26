import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Uploading a specification exists to seed the scoping chat with what the
 * document says. If the parse does not happen, the upload achieved nothing
 * the owner asked for.
 *
 * Every layer used to hide that. ai-service answered 200 with a summary
 * reading "Failed to download specification file.", project-service caught
 * whatever was left and returned success with "AI parsing will process
 * shortly" - which nothing does, there is no queue and no retry - and the
 * scoping page showed an upload-succeeded message either way.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('projectsRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('POST /projects/:id/upload-spec', () => {
  const body = handler("projectsRoute.post('/:id/upload-spec'")

  it('does not promise parsing that nothing performs', () => {
    expect(body).not.toContain('AI parsing will process shortly')
  })

  it('reports a failed parse as a failure', () => {
    expect(body).toContain('AI_SERVICE_UNAVAILABLE')
  })

  it('does not swallow the AI error into a success response', () => {
    expect(body).not.toContain('// AI service unavailable, store file reference anyway')
  })
})

/**
 * Every checkout attempt mints a fresh order id, so an abandoned one leaves a
 * pending escrow_in row behind. The callback matched on project + type +
 * pending with no order filter, so one real payment flipped all of them to
 * completed: phantom deposits with no ledger entries behind them, each
 * counted into the owner's total spend.
 *
 * The order id is stored as the transaction's idempotency key when the Snap
 * token is created, so the callback can name the row it was sent for.
 */
describe('escrow settlement', () => {
  // The settling itself moved to PaymentSettlementService, where the retry
  // behaviour is asserted directly; the order-scoping rule moved with it.
  const settlement = readFileSync(
    path.resolve(__dirname, '../services/payment-settlement.service.ts'),
    'utf8',
  )

  it('completes only the transaction the callback names', () => {
    expect(settlement).toContain('eq(transactions.idempotencyKey, orderId)')
  })
})
