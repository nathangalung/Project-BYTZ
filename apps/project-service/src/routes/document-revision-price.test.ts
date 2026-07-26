import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A revision replaces the document body, and the body carries the estimate
 * the document fee is derived from. Rewriting content without repricing left
 * an unpaid document quoting a fee computed from a scope that no longer
 * exists: revise a small project into a large one and the fee stays at the
 * original figure.
 *
 * Repricing must stop at payment. Once paidAt is set the owner has bought the
 * document at an agreed price, and moving it afterwards would rewrite a
 * completed sale.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('projectsRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('document revision repricing', () => {
  for (const [kind, marker, pricer] of [
    ['BRD', "projectsRoute.post('/:id/brd/revision'", 'priceBrd'],
    ['PRD', "projectsRoute.post('/:id/prd/revision'", 'pricePrd'],
  ] as const) {
    const body = handler(marker)

    it(`reprices an unpaid ${kind} when its body changes`, () => {
      expect(body).toContain(pricer)
    })

    it(`leaves a paid ${kind} at the price it was bought for`, () => {
      expect(body).toContain('paidAt')
    })
  }
})
