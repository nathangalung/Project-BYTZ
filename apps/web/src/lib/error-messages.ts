import { ERROR_I18N_KEYS, type ErrorCode } from '@kerjacus/shared'
import i18n from './i18n'

/**
 * Localize a failed response by its error CODE.
 *
 * The server message is a single hardcoded language and leaks upstream detail,
 * so it never reaches the user. An unrecognised code degrades to the generic
 * message rather than rendering a raw key.
 */
export function localizeErrorCode(code: string | undefined | null): string {
  const fallback = i18n.t(ERROR_I18N_KEYS.INTERNAL_ERROR, { ns: 'errors' })
  const key = code ? ERROR_I18N_KEYS[code as ErrorCode] : undefined
  if (!key) return fallback
  return i18n.t(key, { ns: 'errors', defaultValue: fallback })
}
