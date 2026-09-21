import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DisputeStatus, ProjectStatus } from '@kerjacus/shared'
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

describe('admin status labels', () => {
  it.each(statuses)('%s is labelled in both languages', (status) => {
    expect(idLabels[`status_${status}`]).toBeTruthy()
    expect(enLabels[`status_${status}`]).toBeTruthy()
  })

  it.each(statuses)('%s reads Indonesian in the id catalogue', (status) => {
    expect(idLabels[`status_${status}`]).not.toBe(enLabels[`status_${status}`])
  })

  it('agrees with the web app on the wording an operator and an owner share', () => {
    expect(idLabels.status_in_progress).toBe('Dalam Proses')
    expect(idLabels.status_matched).toBe('Tim Terbentuk')
    expect(idLabels.status_review).toBe('Tinjauan Akhir')
  })

  it('offers the whole enum in the status filter', () => {
    expect(SOURCE).toContain('const STATUS_OPTIONS: readonly ProjectStatus[] = Object.values(')
  })

  /**
   * Intervention is deliberately narrower than the filter: project-service
   * refuses `cancelled` from an admin because cancelling refunds escrow, and
   * the state machine rejects a jump to a stage the project has not reached.
   */
  it('keeps intervention to the four targets the backend accepts', () => {
    const opener = 'const INTERVENTION_TARGETS: readonly ProjectStatus[] = ['
    const declaration = SOURCE.slice(SOURCE.indexOf(opener) + opener.length)
    const targets = declaration.slice(0, declaration.indexOf(']'))
    expect(targets).toContain("'on_hold'")
    expect(targets).toContain("'in_progress'")
    expect(targets).toContain("'disputed'")
    expect(targets).toContain("'review'")
    expect(targets).not.toContain("'cancelled'")
  })

  it('types both badge tables against the shared enums', () => {
    expect(SOURCE).toContain('const STATUS_BADGE: Record<ProjectStatus, string>')
    expect(SOURCE).toContain('const DISPUTE_BADGE: Record<DisputeStatus, string>')
  })
})
