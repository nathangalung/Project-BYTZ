import { describe, expect, it } from 'vitest'
import en from '@/locales/en/project.json'
import id from '@/locales/id/project.json'
import { TAB_LABEL_KEYS, TABS } from './shared'

/**
 * The blind spot `i18n-keys.test.ts` names but cannot cover.
 *
 * That gate reads literal `t('...')` arguments out of the source, so a call
 * that passes a variable is invisible to it. The tab strip does exactly that,
 * and the miss was silent by construction: i18next answers an unknown key with
 * the key itself, so the Overview tab of every project rendered
 * `Ikhtisar | Milestone | Dokumen | time-tracking` - three translated labels
 * and one raw route slug, in the platform's default language. Measured in the
 * browser, not inferred.
 *
 * Coverage cannot see it either. v8 counts the `t()` call as executed and never
 * looks at what came back, so a file can score 100 percent while printing keys
 * at the reader.
 */
describe('project detail tab labels', () => {
  it('gives every tab a label key', () => {
    for (const tab of TABS) {
      expect(TAB_LABEL_KEYS[tab], `no label key for tab "${tab}"`).toBeTruthy()
    }
  })

  it.each([
    ['id', id],
    ['en', en],
  ])('resolves every tab label in %s', (_lang, catalogue) => {
    const entries = catalogue as Record<string, unknown>
    for (const tab of TABS) {
      const key = TAB_LABEL_KEYS[tab]
      expect(typeof entries[key], `"${key}" (tab "${tab}") is missing`).toBe('string')
    }
  })

  /**
   * The specific shape that broke: a tab id used directly as a key. Route ids
   * are kebab-case and keys are snake_case, so an id that happens to match is a
   * coincidence rather than a contract.
   */
  it('never renders a route slug as a label', () => {
    for (const tab of TABS) {
      const label = (id as Record<string, string>)[TAB_LABEL_KEYS[tab]]
      expect(label).not.toBe(tab)
      expect(label).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/)
    }
  })
})
