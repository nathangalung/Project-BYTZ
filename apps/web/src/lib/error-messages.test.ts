import { ERROR_CODES, ERROR_I18N_KEYS } from '@kerjacus/shared'
import { afterAll, describe, expect, it } from 'vitest'
import notificationsSource from '../hooks/use-notifications.ts?raw'
import milestonesSource from '../routes/_authenticated/projects/$projectId/milestones.tsx?raw'
import apiSource from './api.ts?raw'
import { localizeErrorCode } from './error-messages'
import i18n from './i18n'

/**
 * The catalog once prefixed every value with 'errors.', which is also the
 * i18next namespace, so a lookup resolved to 'errors:errors.auth.*' and missed
 * the bundle. Nothing in the frontend called it, so the miss never surfaced —
 * api.ts displayed the server's raw message instead, leaking hardcoded
 * Indonesian to English users along with upstream detail.
 */

const CODES = Object.values(ERROR_CODES)

afterAll(async () => {
  await i18n.changeLanguage('id')
})

describe('error code to localized message', () => {
  it('translates a known code in Indonesian', async () => {
    await i18n.changeLanguage('id')
    expect(localizeErrorCode('AUTH_INVALID_CREDENTIALS')).toBe('Email atau password salah')
  })

  it('translates the same code in English', async () => {
    await i18n.changeLanguage('en')
    expect(localizeErrorCode('AUTH_INVALID_CREDENTIALS')).toBe('Invalid email or password')
  })

  it('differs per language for every code', async () => {
    const seen = new Map<string, string>()
    await i18n.changeLanguage('id')
    for (const code of CODES) seen.set(code, localizeErrorCode(code))
    await i18n.changeLanguage('en')
    // A copy-pasted English bundle would leave most of these identical.
    const identical = CODES.filter((code) => localizeErrorCode(code) === seen.get(code))
    expect(identical).toEqual([])
  })
})

describe('graceful fallback', () => {
  it.each(['id', 'en'])('an unknown code reads as the generic message in %s', async (lang) => {
    await i18n.changeLanguage(lang)
    const generic = localizeErrorCode('INTERNAL_ERROR')
    expect(localizeErrorCode('SOME_CODE_WE_NEVER_SHIPPED')).toBe(generic)
    expect(localizeErrorCode(undefined)).toBe(generic)
  })

  it('never renders a raw key', async () => {
    for (const lang of ['id', 'en']) {
      await i18n.changeLanguage(lang)
      for (const code of [...CODES, 'UNKNOWN_ERROR']) {
        expect(localizeErrorCode(code), `${lang}/${code}`).not.toMatch(/^[a-z_]+\.[a-z_]+$/)
      }
    }
  })
})

describe('the namespace prefix collision', () => {
  it('keeps catalog keys relative to the errors namespace', () => {
    for (const code of CODES) {
      expect(ERROR_I18N_KEYS[code], code).not.toMatch(/^errors\./)
    }
  })

  it('resolves every code in both bundles, with no errors.errors. leftover', async () => {
    for (const lang of ['id', 'en']) {
      await i18n.changeLanguage(lang)
      for (const code of CODES) {
        const message = localizeErrorCode(code)
        expect(message, `${lang}/${code}`).not.toContain('errors.errors.')
        expect(message.trim(), `${lang}/${code}`).not.toBe('')
      }
    }
  })

  it('defines each catalog key in both locale bundles', () => {
    for (const lang of ['id', 'en'] as const) {
      const bundle = (i18n.getResourceBundle(lang, 'errors') ?? {}) as Record<
        string,
        Record<string, string>
      >
      for (const code of CODES) {
        const [group, key] = ERROR_I18N_KEYS[code].split('.')
        expect(bundle[group]?.[key], `${lang}/errors.${code}`).toBeTruthy()
      }
    }
  })
})

describe('the API client boundary', () => {
  it('builds the message from the code, not the server body', () => {
    expect(apiSource).toContain('localizeErrorCode')
    expect(apiSource).not.toContain('error?.message')
  })

  // Callers that branched on the old English message text would now silently
  // stop matching, so they have to branch on code or status instead.
  it('routes the revision cap to checkout by code, not message text', () => {
    expect(milestonesSource).toContain("err.code === 'MILESTONE_REVISION_LIMIT'")
    expect(milestonesSource).not.toContain("includes('revision limit')")
  })

  it('swallows notification polling noise by status, not message text', () => {
    expect(notificationsSource).toContain('error.status === 404')
    expect(notificationsSource).not.toContain("message.includes('404')")
  })
})
