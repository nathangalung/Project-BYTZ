import { ProjectStatus } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import enCommon from '@/locales/en/common.json'
import enProject from '@/locales/en/project.json'
import idCommon from '@/locales/id/common.json'
import idProject from '@/locales/id/project.json'
import {
  PROJECT_STATUS_BADGE,
  PROJECT_STATUSES,
  projectStatusBadge,
  projectStatusLabelKey,
} from './project-status'

/**
 * Three of the eighteen statuses rendered an unstyled badge and five had two
 * different Indonesian words depending on whether you looked at the card or
 * the header. Both were invisible to the suite: a missing map entry is
 * `undefined` in a class list, and a second catalogue is only wrong when you
 * compare the two. This test compares them.
 */
describe('project status presentation', () => {
  const catalogues = [
    ['id', idProject as Record<string, string>],
    ['en', enProject as Record<string, string>],
  ] as const

  it('knows the same statuses as the shared enum', () => {
    expect([...PROJECT_STATUSES]).toEqual(Object.values(ProjectStatus))
    expect(PROJECT_STATUSES).toHaveLength(18)
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
    expect((idProject as Record<string, string>).status_matched).toBe('Tim Terbentuk')
  })

  it('falls back to the draft style for a status no enum holds', () => {
    expect(projectStatusBadge('in_progress')).toBe(PROJECT_STATUS_BADGE.in_progress)
    expect(projectStatusBadge('archived')).toBe(PROJECT_STATUS_BADGE.draft)
  })
})
