import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Midtrans retries are routine - this file's own header says so. Every
 * settlement branch therefore has to survive the same callback arriving twice
 * at once, and all three did their check as a separate statement from their
 * write.
 *
 * The revision branch is the expensive one. It SELECTs revision_requests by
 * fee_transaction_id, then INSERTs. Two concurrent deliveries both find
 * nothing and both insert, and consumePaidRevisionCredit pops one credit per
 * revision, so the owner gets a free paid revision. The comment above it
 * claims the bug was fixed by keying the credit to the transaction: the key
 * was added, the uniqueness never was.
 */

const source = readFileSync(path.resolve(__dirname, './payment-settlement.service.ts'), 'utf8')

function method(name: string): string {
  const start = source.indexOf(`private async ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('\n  private async ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('settleDocument', () => {
  const body = method('settleDocument')

  /**
   * The UPDATE is the guard. Reading paid_at and then writing it lets two
   * callbacks both see null and both report a fresh sale.
   */
  it('makes the write conditional on the sale not being booked', () => {
    expect(body).toMatch(/isNull\(table\.paidAt\)/)
  })

  it('decides from what the write returned', () => {
    expect(body).toContain('.returning(')
  })
})

describe('settleRevision', () => {
  const body = method('settleRevision')

  /**
   * The insert must lose the race rather than duplicate through it, which
   * needs the constraint below plus a conflict clause to hit it.
   */
  it('inserts only when no credit exists for the payment', () => {
    expect(body).toContain('onConflictDoNothing')
    expect(body).toContain('.returning(')
  })
})

describe('settlement migrations', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../packages/db/migrations')
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n')

  /**
   * Partial: fee_transaction_id is null for the free revisions, which are
   * legitimately many per milestone.
   */
  it('admits one paid revision credit per payment', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "revision_requests_fee_transaction_unique" ON "revision_requests"[^;]*\("fee_transaction_id"\)[^;]*WHERE[^;]*not null/i,
    )
  })
})
