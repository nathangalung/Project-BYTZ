import { describe, expect, it } from 'vitest'
import enLocale from '@/locales/en/project.json'
import idLocale from '@/locales/id/project.json'
import SOURCE from './scoping.tsx?raw'

/**
 * The scoping page opened on an empty chat: the owner finished a long intake
 * form, landed on a bot with nothing to say, and had no way to tell what was
 * missing or what to type. The assistant now opens from the form's own gaps.
 *
 * Every label it renders is looked up by a computed key, and i18next prints
 * the key itself when one is absent, so a gap in the locale files shows the
 * owner "scoping_prompt_metrics" instead of a question. That is what these
 * assertions guard.
 */

function locale(lang: string): Record<string, string | undefined> {
  return (lang === 'id' ? idLocale : enLocale) as Record<string, string | undefined>
}

// Mirrors computeFormCompleteness in the project service and
// _completeness_checks in the AI service.
const GAPS = [
  'description',
  'problem',
  'objectives',
  'features',
  'users',
  'requirements',
  'risks',
  'metrics',
  'budget',
  'timeline',
  'integrations',
]

describe('scoping opening copy', () => {
  it.each(['id', 'en'])('labels and prompts every gap in %s', (lang) => {
    const dict = locale(lang)
    for (const gap of GAPS) {
      expect(dict[`missing_${gap}`], `missing_${gap}`).toBeTruthy()
      expect(dict[`scoping_prompt_${gap}`], `scoping_prompt_${gap}`).toBeTruthy()
    }
  })

  it.each(['id', 'en'])('carries the opening message itself in %s', (lang) => {
    const dict = locale(lang)
    for (const key of [
      'scoping_welcome',
      'scoping_opening_read_form',
      'scoping_opening_missing_intro',
      'scoping_opening_next',
      'scoping_opening_complete',
    ]) {
      expect(dict[key], key).toBeTruthy()
    }
  })

  it('interpolates the placeholders the component passes', () => {
    for (const lang of ['id', 'en']) {
      expect(locale(lang).scoping_opening_read_form).toContain('{{percent}}')
      expect(locale(lang).scoping_opening_next).toContain('{{item}}')
    }
  })

  it('keeps both locales at the same key set', () => {
    expect(Object.keys(locale('id')).sort()).toEqual(Object.keys(locale('en')).sort())
  })

  /**
   * scoping_welcome sat unused in both locales while the page rendered a grey
   * "start the conversation" hint instead. The greeting was written and never
   * wired; the hint it lost out to is the thing the owner complained about.
   */
  it('renders the greeting instead of the hint it replaced', () => {
    expect(SOURCE).toContain("t('scoping_welcome')")
    expect(SOURCE).not.toContain('scoping_empty_hint')
    for (const lang of ['id', 'en']) {
      expect(locale(lang).scoping_empty_hint).toBeUndefined()
    }
  })

  it('states the gaps rather than leaving the owner to guess', () => {
    expect(SOURCE).toContain('ScopingOpening')
    expect(SOURCE).toContain('scoping_opening_missing_intro')
    expect(SOURCE).toContain('scoping_prompt_')
  })
})
