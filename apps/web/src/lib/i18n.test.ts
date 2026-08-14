import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import i18n from './i18n'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const publicHeader = readSource('../components/layout/public-header.tsx')
const authorized = readSource('../routes/_authenticated.tsx')

/**
 * The switcher toggled on i18n.language, which carries whatever the browser
 * reported. A navigator value of id-ID or en-GB is not equal to 'id' or 'en',
 * so the comparison read as "currently English" while Indonesian was on screen
 * via fallback, and the first click appeared to do nothing.
 *
 * load: 'languageOnly' collapses a region to its base, and resolvedLanguage is
 * the code i18next actually renders with, so both sides now agree.
 */

describe('i18n setup', () => {
  it('offers exactly Indonesian and English', () => {
    expect(i18n.options.supportedLngs).toEqual(expect.arrayContaining(['id', 'en']))
  })

  // i18next normalises fallbackLng to an array.
  it('falls back to Indonesian', () => {
    expect(i18n.options.fallbackLng).toEqual(['id'])
  })

  it('drops the region, so id-ID resolves to id', () => {
    expect(i18n.options.load).toBe('languageOnly')
  })

  it('remembers the choice across reloads', () => {
    expect(i18n.options.detection?.caches).toContain('localStorage')
    expect(i18n.options.detection?.order?.[0]).toBe('localStorage')
  })

  it('ships both bundles for every namespace', () => {
    for (const ns of i18n.options.ns as string[]) {
      expect(i18n.getResourceBundle('id', ns), `id/${ns}`).toBeTruthy()
      expect(i18n.getResourceBundle('en', ns), `en/${ns}`).toBeTruthy()
    }
  })
})

describe('language switching', () => {
  it('switches to English and back', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    await i18n.changeLanguage('id')
    expect(i18n.resolvedLanguage).toBe('id')
  })

  it('resolves a regional code to a supported base', async () => {
    await i18n.changeLanguage('id-ID')
    expect(i18n.resolvedLanguage).toBe('id')
    await i18n.changeLanguage('en-GB')
    expect(i18n.resolvedLanguage).toBe('en')
    await i18n.changeLanguage('id')
  })

  it('translates the same key in both languages', async () => {
    await i18n.changeLanguage('en')
    const en = i18n.t('submit_review', { ns: 'project' })
    await i18n.changeLanguage('id')
    const id = i18n.t('submit_review', { ns: 'project' })
    expect(en).not.toBe('submit_review')
    expect(id).not.toBe('submit_review')
    expect(en).not.toBe(id)
  })
})

describe('the switchers', () => {
  it.each([
    ['authenticated shell', authorized],
    ['public header', publicHeader],
  ])('compares resolvedLanguage in the %s', (_name, source) => {
    expect(source).toContain('resolvedLanguage')
    expect(source).not.toMatch(/i18n\.language === 'id'/)
  })
})

describe('keys that once rendered raw are defined in both languages', () => {
  const cases: Array<[string, string[]]> = [
    [
      'document',
      [
        'prd_not_created',
        'prd_not_created_desc',
        'prd_generated_success',
        'prd_generated_error',
        'prd_generating',
        'generate_prd',
        'prd_needs_brd',
        'method',
        'description',
      ],
    ],
    ['payment', ['loading_project', 'project_load_error', 'project_load_error_desc']],
    [
      'project',
      ['load_error', 'talent_count', 'progress', 'document_type', 'brd_template_completeness'],
    ],
    ['common', ['something_wrong', 'try_again']],
  ]

  it.each(cases)('%s namespace defines its keys in id and en', (ns, keys) => {
    for (const lang of ['id', 'en'] as const) {
      const bundle = (i18n.getResourceBundle(lang, ns) ?? {}) as Record<string, unknown>
      for (const key of keys) {
        expect(bundle[key], `${lang}/${ns}.${key}`).toBeTruthy()
      }
    }
  })
})
