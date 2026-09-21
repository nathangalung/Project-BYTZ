import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssignmentStatus, DisputeStatus, ProjectStatus } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import en from '@/locales/en/admin.json'
import id from '@/locales/id/admin.json'

/**
 * The console's Indonesian status labels were the English ones, copied.
 * Nothing failed: `statusLabel` answers a missing key with the key's own words
 * ("brd purchased"), and an identical translation is only wrong when you hold
 * the two catalogues side by side. This test holds them side by side.
 */

const SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '_authenticated/projects.tsx'),
  'utf8',
)

const idLabels = id as Record<string, string>
const enLabels = en as Record<string, string>
const statuses = [...Object.values(ProjectStatus), ...Object.values(DisputeStatus)]
/**
 * disputed and on_hold left project_status and became conditions a project
 * carries at any position. They still need a word on screen, under their own
 * key, because the badge shows them beside the position rather than instead
 * of it.
 */
const conditions = ['disputed', 'on_hold'] as const

describe('admin status labels', () => {
  it.each(statuses)('%s is labelled in both languages', (status) => {
    expect(idLabels[`status_${status}`]).toBeTruthy()
    expect(enLabels[`status_${status}`]).toBeTruthy()
  })

  it.each(statuses)('%s reads Indonesian in the id catalogue', (status) => {
    expect(idLabels[`status_${status}`]).not.toBe(enLabels[`status_${status}`])
  })

  it.each(conditions)('%s is labelled as a condition in both languages', (condition) => {
    expect(idLabels[`condition_${condition}`]).toBeTruthy()
    expect(enLabels[`condition_${condition}`]).toBeTruthy()
    expect(idLabels[`condition_${condition}`]).not.toBe(enLabels[`condition_${condition}`])
  })

  /** A dropped value must not linger as an orphan key nothing can reach. */
  it.each([
    'brd_generated',
    'brd_approved',
    'brd_purchased',
    'prd_generated',
    'prd_approved',
    'prd_purchased',
    'team_forming',
    'matched',
    'partially_active',
    'disputed',
    'on_hold',
  ])('%s has no leftover status label', (dropped) => {
    expect(idLabels[`status_${dropped}`]).toBeUndefined()
    expect(enLabels[`status_${dropped}`]).toBeUndefined()
  })

  it('agrees with the web app on the wording an operator and an owner share', () => {
    expect(idLabels.status_in_progress).toBe('Dalam Proses')
    expect(idLabels.status_final_review).toBe('Tinjauan Akhir')
    expect(idLabels.condition_disputed).toBe('Sengketa')
  })

  it('offers the whole enum in the status filter', () => {
    expect(SOURCE).toContain('const STATUS_OPTIONS: readonly ProjectStatus[] = Object.values(')
  })

  /**
   * Intervention is deliberately narrower than the filter: project-service
   * refuses `cancelled` from an admin because cancelling refunds escrow, and
   * the state machine rejects a jump to a stage the project has not reached.
   *
   * on_hold and disputed used to be offered here and are not positions any
   * more. Nothing on this console writes on_hold_at or opens a dispute yet, so
   * offering them would only produce a 400.
   */
  it('offers no target that is not a position', () => {
    const opener = 'const INTERVENTION_TARGETS: readonly ProjectStatus[] = ['
    const declaration = SOURCE.slice(SOURCE.indexOf(opener) + opener.length)
    const targets = declaration.slice(0, declaration.indexOf(']'))
    expect(targets).toContain("'in_progress'")
    expect(targets).toContain("'final_review'")
    expect(targets).not.toContain("'on_hold'")
    expect(targets).not.toContain("'disputed'")
    expect(targets).not.toContain("'cancelled'")
  })

  /**
   * The badge composes. An operator opens this page to find a stuck project,
   * and a disputed one used to show `disputed` and nothing at all about where
   * the work stood.
   */
  it('renders the conditions beside the position, not instead of it', () => {
    expect(SOURCE).toContain('function ProjectStatusCell(')
    expect(SOURCE).toContain("const CONDITION_BADGE: Record<'disputed' | 'on_hold', string>")
    expect(SOURCE).toContain('project.isDisputed &&')
    expect(SOURCE).toContain('project.onHoldAt &&')
  })

  it('types both badge tables against the shared enums', () => {
    expect(SOURCE).toContain('const STATUS_BADGE: Record<ProjectStatus, string>')
    expect(SOURCE).toContain('const DISPUTE_BADGE: Record<DisputeStatus, string>')
  })
})

/**
 * assignment_status absorbed the acceptance_status column. Every one of the
 * four positions now reaches the screen on its own - an offer used to be
 * `active` with the acceptance column saying otherwise - so each needs a word
 * and a colour, and the two dropped vocabularies must leave no orphan key.
 */
describe('admin assignment status labels', () => {
  const assignments = Object.values(AssignmentStatus)

  it.each(assignments)('%s is labelled in both languages', (status) => {
    expect(idLabels[`assignment_status_${status}`]).toBeTruthy()
    expect(enLabels[`assignment_status_${status}`]).toBeTruthy()
  })

  it.each(assignments)('%s reads Indonesian in the id catalogue', (status) => {
    expect(idLabels[`assignment_status_${status}`]).not.toBe(
      enLabels[`assignment_status_${status}`],
    )
  })

  it.each(['pending', 'accepted', 'declined', 'terminated', 'replaced'])(
    '%s has no leftover assignment label',
    (dropped) => {
      expect(idLabels[`assignment_status_${dropped}`]).toBeUndefined()
      expect(enLabels[`assignment_status_${dropped}`]).toBeUndefined()
    },
  )

  it('styles every position, so none falls through to the error badge', () => {
    expect(SOURCE).toContain('const ASSIGNMENT_BADGE: Record<AssignmentStatus, string>')
    const opener = 'const ASSIGNMENT_BADGE: Record<AssignmentStatus, string> = {'
    const table = SOURCE.slice(SOURCE.indexOf(opener) + opener.length)
    const body = table.slice(0, table.indexOf('}'))
    for (const status of assignments) {
      expect(body).toContain(`${status}:`)
    }
  })

  it('translates the badge rather than printing the raw value', () => {
    expect(SOURCE).toContain('label={assignmentStatusLabel(worker.status)}')
    expect(SOURCE).toMatch(/t\(`assignment_status_\$\{status\}`/)
  })
})
