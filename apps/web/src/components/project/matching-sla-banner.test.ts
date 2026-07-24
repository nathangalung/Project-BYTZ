import { describe, expect, it } from 'vitest'
import i18n from '../../lib/i18n'
import projectDetail from '../../routes/_authenticated/projects/$projectId/index.tsx?raw'
import matchingPage from '../../routes/_authenticated/projects/$projectId/matching.tsx?raw'
import banner from './matching-sla-banner.tsx?raw'

/**
 * The product promises 72 hours to match one talent and 14 days to assemble a
 * team, and matching.json carried a matching_sla string for it, but nothing
 * rendered the string and no page showed a deadline. The banner reads the
 * clock from project_status_logs, since createdAt predates scoping and
 * updatedAt moves on every edit.
 */

describe('the banner', () => {
  it('dates the clock from the status log, not the project row', () => {
    expect(banner).toContain('useProjectStatusLogs')
    expect(banner).toContain('matchingSlaFromLogs')
    expect(banner).not.toContain('createdAt')
    expect(banner).not.toContain('updatedAt')
  })

  it('renders only while matching is running', () => {
    expect(banner).toContain('isMatchingSlaStatus')
  })

  it('separates the breached case from the countdown', () => {
    expect(banner).toContain('sla.breached')
    expect(banner).toContain("t('sla_breached')")
  })

  it('skips the request outside matching', () => {
    expect(banner).toMatch(/useProjectStatusLogs\(projectId,\s*active\)/)
  })
})

describe('where it is mounted', () => {
  it.each([
    ['project detail', projectDetail],
    ['matching page', matchingPage],
  ])('%s renders it', (_name, source) => {
    expect(source).toContain('<MatchingSlaBanner')
    expect(source).toContain("from '@/components/project/matching-sla-banner'")
  })
})

describe('matching namespace', () => {
  const keys = [
    'matching_sla',
    'sla_deadline',
    'sla_breached',
    'sla_breached_desc',
    'sla_days_other',
    'sla_hours_other',
    'sla_minutes_other',
  ]

  it.each(['id', 'en'] as const)('%s defines every sla key', (lang) => {
    const bundle = (i18n.getResourceBundle(lang, 'matching') ?? {}) as Record<string, unknown>
    for (const key of keys) {
      expect(bundle[key], `${lang}/matching.${key}`).toBeTruthy()
    }
  })

  // Keys the page stopped rendering long ago.
  it.each(['id', 'en'] as const)('%s carries no dead keys', (lang) => {
    const bundle = (i18n.getResourceBundle(lang, 'matching') ?? {}) as Record<string, unknown>
    for (const key of ['skill_match', 'request_other', 'waiting_response', 'score_breakdown']) {
      expect(bundle[key], `${lang}/matching.${key}`).toBeUndefined()
    }
  })

  it.each(['id', 'en'] as const)('%s counts down with a plural form', async (lang) => {
    await i18n.changeLanguage(lang)
    expect(i18n.t('sla_hours', { ns: 'matching', count: 3 })).toContain('3')
    await i18n.changeLanguage('id')
  })
})
