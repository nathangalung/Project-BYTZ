import { describe, expect, it } from 'vitest'
import i18n from '../../lib/i18n'
import matchingPage from '../../routes/_authenticated/projects/$projectId/matching.tsx?raw'

/**
 * The PRD says which work package blocks which, and the projects route now
 * stores that graph, but the owner staffing a team could not see it: every
 * position looked equally ready to fill. The positions endpoint resolves each
 * open package's prerequisites to titles and the page names them, so the owner
 * staffs the blocker first.
 */

describe('the staffing page', () => {
  it('reads the prerequisites the endpoint sends', () => {
    expect(matchingPage).toContain('dependsOn?: string[]')
    expect(matchingPage).toContain('dependsOn: p.dependsOn ?? []')
  })

  it('names them per position', () => {
    expect(matchingPage).toContain('position.dependsOn.length > 0')
    expect(matchingPage).toContain('position.dependsOn.map')
    expect(matchingPage).toContain("t('depends_on')")
  })

  it('shows nothing when the graph is empty', () => {
    expect(matchingPage).toMatch(/position\.dependsOn\.length > 0 && \(/)
  })
})

describe('matching namespace', () => {
  it.each(['id', 'en'] as const)('%s defines the prerequisite label', (lang) => {
    const bundle = (i18n.getResourceBundle(lang, 'matching') ?? {}) as Record<string, unknown>
    expect(bundle.depends_on, `${lang}/matching.depends_on`).toBeTruthy()
  })
})
