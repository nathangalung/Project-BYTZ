import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import EN from '../locales/en/project.json'
import ID from '../locales/id/project.json'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const SOURCE = readSource('./_public/project-detail.$projectId.tsx')

/**
 * public_detail promises a browser the scope of the work, and until now the
 * page showed a truncated brief and a row of work package titles. The backend
 * serves that scope as `project.scope`, a projection of the PRD with every
 * money field left behind, and this is the surface that reads it.
 *
 * The page must not reach for a price. The projection has none, so a template
 * referencing amount or totalCost would render undefined - and would mean
 * someone had put the money back into the payload.
 */

describe('public project scope section', () => {
  it('renders the scope the backend serves', () => {
    expect(SOURCE).toContain('project.scope')
    expect(SOURCE).toContain('ProjectScope')
  })

  it('shows the work packages with their deliverables and criteria', () => {
    expect(SOURCE).toContain('scope.workPackages')
    expect(SOURCE).toContain('acceptanceCriteria')
    expect(SOURCE).toContain('deliverables')
  })

  it('never reads a price off the scope', () => {
    expect(SOURCE).not.toContain('scope.totalCost')
    expect(SOURCE).not.toContain('wp.amount')
    expect(SOURCE).not.toContain('talentPayout')
  })

  // Every user-facing string goes through t(); a raw literal here would ship
  // English into an Indonesian-default product.
  it('has both locales for the headings it introduces', () => {
    for (const key of ['assumptions', 'acceptance_criteria']) {
      expect(ID, `id/project.json is missing ${key}`).toHaveProperty(key)
      expect(EN, `en/project.json is missing ${key}`).toHaveProperty(key)
    }
  })
})
