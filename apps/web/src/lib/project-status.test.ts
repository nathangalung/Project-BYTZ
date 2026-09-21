import { ProjectStatus } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import enCommon from '@/locales/en/common.json'
import enProject from '@/locales/en/project.json'
import idCommon from '@/locales/id/common.json'
import idProject from '@/locales/id/project.json'
import {
  PROJECT_CONDITION_BADGE,
  PROJECT_STATUS_BADGE,
  PROJECT_STATUSES,
  type ProjectCondition,
  projectConditionLabelKey,
  projectConditions,
  projectStatusBadge,
  projectStatusLabelKey,
} from './project-status'

/**
 * Three of the statuses rendered an unstyled badge and five had two different
 * Indonesian words depending on whether you looked at the card or the header.
 * Both were invisible to the suite: a missing map entry is `undefined` in a
 * class list, and a second catalogue is only wrong when you compare the two.
 * This test compares them.
 */
describe('project status presentation', () => {
  const catalogues = [
    ['id', idProject as Record<string, string>],
    ['en', enProject as Record<string, string>],
  ] as const

  /**
   * The literal count is what keeps the rest of this file honest: every other
   * assertion walks `PROJECT_STATUSES`, so an enum that silently emptied or
   * regrew its dropped values would satisfy all of them vacuously.
   */
  it('knows the same statuses as the shared enum', () => {
    expect([...PROJECT_STATUSES]).toEqual(Object.values(ProjectStatus))
    expect(PROJECT_STATUSES).toHaveLength(9)
  })

  it.each([...PROJECT_STATUSES])('styles %s', (status) => {
    expect(PROJECT_STATUS_BADGE[status]).toMatch(/^bg-/)
    expect(PROJECT_STATUS_BADGE[status]).toContain('text-')
  })

  it.each(catalogues)('labels every status in %s', (_language, catalogue) => {
    const missing = PROJECT_STATUSES.filter((status) => !catalogue[projectStatusLabelKey(status)])
    expect(missing).toEqual([])
  })

  // The card read `project`, the detail header read `common`, and the two
  // catalogues had drifted. One owns these labels now.
  it.each([
    ['id', idCommon as Record<string, string>],
    ['en', enCommon as Record<string, string>],
  ])('keeps no second copy of the labels in %s/common.json', (_language, catalogue) => {
    const duplicated = PROJECT_STATUSES.filter((status) => catalogue[projectStatusLabelKey(status)])
    expect(duplicated).toEqual([])
  })

  it('reads the Indonesian label a card and a detail header now share', () => {
    expect((idProject as Record<string, string>).status_in_progress).toBe('Dalam Proses')
    expect((idProject as Record<string, string>).status_final_review).toBe('Tinjauan Akhir')
  })

  it('falls back to the draft style for a status no enum holds', () => {
    expect(projectStatusBadge('in_progress')).toBe(PROJECT_STATUS_BADGE.in_progress)
    expect(projectStatusBadge('archived')).toBe(PROJECT_STATUS_BADGE.draft)
  })
})

/**
 * `disputed` and `on_hold` used to be positions, so a disputed project forgot
 * where it was: the badge said "Disengketakan" and nothing about whether the
 * work was half done or waiting to be signed off. They are conditions now and
 * compose with a position, which only holds if they carry their own styling
 * and their own labels - a condition with neither would render as a blank
 * second badge, the exact failure the position badges already had.
 */
describe('project condition presentation', () => {
  const CONDITIONS: ProjectCondition[] = ['disputed', 'on_hold']

  it.each(CONDITIONS)('styles %s', (condition) => {
    expect(PROJECT_CONDITION_BADGE[condition]).toMatch(/^bg-/)
    expect(PROJECT_CONDITION_BADGE[condition]).toContain('text-')
  })

  it.each([
    ['id', idProject as Record<string, string>],
    ['en', enProject as Record<string, string>],
  ])('labels every condition in %s', (_language, catalogue) => {
    const missing = CONDITIONS.filter((c) => !catalogue[projectConditionLabelKey(c)])
    expect(missing).toEqual([])
  })

  it('reads no condition off a project standing at a plain position', () => {
    expect(projectConditions({ isDisputed: false, onHoldAt: null })).toEqual([])
    expect(projectConditions(null)).toEqual([])
    expect(projectConditions(undefined)).toEqual([])
  })

  it.each([
    [{ isDisputed: true }, ['disputed']],
    [{ onHoldAt: '2026-03-01T00:00:00.000Z' }, ['on_hold']],
  ])('reads %o as %o', (project, expected) => {
    expect(projectConditions(project)).toEqual(expected)
  })

  /** A dispute leads: it is the one that stops the money. */
  it('puts a dispute ahead of a hold when both stand at once', () => {
    expect(projectConditions({ isDisputed: true, onHoldAt: '2026-03-01T00:00:00.000Z' })).toEqual([
      'disputed',
      'on_hold',
    ])
  })

  /**
   * The composition is the whole point of the split: a project is AT a
   * position and a condition is true of it, so the position must survive
   * being disputed rather than being overwritten by it.
   */
  it('keeps the position styled beside the conditions standing on it', () => {
    const project = { isDisputed: true, onHoldAt: '2026-03-01T00:00:00.000Z' }

    expect(projectStatusBadge('in_progress')).toBe(PROJECT_STATUS_BADGE.in_progress)
    expect(projectConditions(project).map((c) => PROJECT_CONDITION_BADGE[c])).toEqual([
      PROJECT_CONDITION_BADGE.disputed,
      PROJECT_CONDITION_BADGE.on_hold,
    ])
  })

  /** The dropped positions must not come back as statuses through the labels. */
  it.each(['disputed', 'on_hold'])('keeps %s out of the status catalogue', (dropped) => {
    expect(PROJECT_STATUSES).not.toContain(dropped)
    expect((idProject as Record<string, string>)[projectStatusLabelKey(dropped)]).toBeUndefined()
    expect((enProject as Record<string, string>)[projectStatusLabelKey(dropped)]).toBeUndefined()
  })
})
