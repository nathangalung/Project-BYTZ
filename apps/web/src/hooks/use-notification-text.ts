import { useTranslation } from 'react-i18next'

/**
 * The parts of a notification that decide what it says.
 *
 * Rows written before the catalog existed carry only title and message, which
 * is why templateKey is nullable and why the fallback below is the correct
 * answer there rather than a missing feature.
 */
export type RenderableNotification = {
  title: string
  message: string
  templateKey: string | null
  templateParams: Record<string, unknown> | null
}

/**
 * Renders a notification in the reader's own language.
 *
 * The stored title and message are the fallback, not the source: they were
 * rendered by notification-service in the locale on the user row, which is the
 * language they had when it was sent. Reading from the key instead means
 * switching languages re-reads the whole inbox rather than only what arrives
 * next.
 *
 * Params go through i18next's `replace` rather than being spread into the
 * options object. Spread, a param named `count`, `context`, or `ns` would stop
 * being a value to interpolate and start steering the lookup.
 */
export function useNotificationText() {
  const { t } = useTranslation('notification')

  return function render(notification: RenderableNotification): {
    title: string
    message: string
  } {
    const key = notification.templateKey
    if (!key) return { title: notification.title, message: notification.message }
    const replace = notification.templateParams ?? {}
    return {
      // defaultValue is what makes an unknown key degrade to the wording the
      // row already carries instead of printing the key at the reader.
      title: t(`${key}.title`, { defaultValue: notification.title, replace }),
      message: t(`${key}.message`, { defaultValue: notification.message, replace }),
    }
  }
}
