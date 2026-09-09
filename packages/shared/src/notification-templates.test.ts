import { describe, expect, it } from 'vitest'
import {
  formatNotificationCurrency,
  NOTIFICATION_TEMPLATES,
  renderNotificationTemplate,
} from './notification-templates'

const KEYS = Object.keys(NOTIFICATION_TEMPLATES) as (keyof typeof NOTIFICATION_TEMPLATES)[]
const PLACEHOLDER = /\{\{(\w+)(?:,\s*(\w+))?\}\}/g

describe('formatNotificationCurrency', () => {
  // The Go renderer writes the email body and this one writes the in-app text,
  // so both have to group Rupiah the same way or one reader sees a different
  // number than the other for the same notification.
  it.each([
    [0, 'Rp 0'],
    [7, 'Rp 7'],
    [999, 'Rp 999'],
    [1_000, 'Rp 1.000'],
    [18_000_000, 'Rp 18.000.000'],
    [7_150_000, 'Rp 7.150.000'],
    [1_000_000_000, 'Rp 1.000.000.000'],
    [-2_500, '-Rp 2.500'],
  ])('formats %d as %s', (value, want) => {
    expect(formatNotificationCurrency(value)).toBe(want)
  })
})

describe('renderNotificationTemplate', () => {
  it('substitutes a plain value', () => {
    expect(renderNotificationTemplate('Status {{status}}.', { status: 'matched' })).toBe(
      'Status matched.',
    )
  })

  it('formats a currency placeholder', () => {
    expect(renderNotificationTemplate('{{amount, currency}}', { amount: 7_150_000 })).toBe(
      'Rp 7.150.000',
    )
  })

  // A visible placeholder is a bug report. An empty gap is a sentence that
  // reads as finished and is wrong, which is the failure this avoids.
  it('leaves an unfilled placeholder standing', () => {
    expect(renderNotificationTemplate('Hi {{name}}')).toBe('Hi {{name}}')
  })

  it('leaves an unparseable currency standing', () => {
    expect(renderNotificationTemplate('{{amount, currency}}', { amount: 'abc' })).toBe(
      '{{amount, currency}}',
    )
  })

  it('returns a template with no placeholders unchanged', () => {
    expect(renderNotificationTemplate('Nothing to fill.', { a: 1 })).toBe('Nothing to fill.')
  })
})

describe('the catalog', () => {
  it('ships every template in both languages', () => {
    expect(KEYS.length).toBeGreaterThan(0)
    for (const key of KEYS) {
      for (const locale of ['id', 'en'] as const) {
        const template = NOTIFICATION_TEMPLATES[key][locale]
        expect(template.title.trim(), `${key} [${locale}] title`).not.toBe('')
        expect(template.message.trim(), `${key} [${locale}] message`).not.toBe('')
      }
    }
  })

  // Two translations asking for different params means one of them renders a
  // placeholder the handler never supplies, in whichever language the reader
  // happens to have chosen.
  it('asks for the same params in both languages', () => {
    for (const key of KEYS) {
      const entry = NOTIFICATION_TEMPLATES[key]
      const params = (locale: 'id' | 'en') =>
        [...`${entry[locale].title} ${entry[locale].message}`.matchAll(PLACEHOLDER)]
          .map((m) => m[0])
          .sort()
      expect(params('id'), `${key} placeholders`).toEqual(params('en'))
    }
  })

  // CLAUDE.md's naming convention: NATS subject 'milestone.submitted' becomes
  // 'notification.milestone_submitted'. A key that drifts from it is a key the
  // catalog table in that document no longer describes.
  it('names every key under the notification prefix in snake_case', () => {
    for (const key of KEYS) {
      expect(key, `${key} prefix`).toMatch(/^notification\.[a-z0-9]+(_[a-z0-9]+)*$/)
    }
  })

  it('uses only the interpolation forms both renderers implement', () => {
    for (const key of KEYS) {
      for (const locale of ['id', 'en'] as const) {
        const text = `${NOTIFICATION_TEMPLATES[key][locale].title} ${NOTIFICATION_TEMPLATES[key][locale].message}`
        // Any brace pair that the shared pattern does not match is one the Go
        // side cannot parse either, and it would print raw at the reader.
        const braces = text.match(/\{\{[^}]*\}\}/g) ?? []
        const understood = text.match(PLACEHOLDER) ?? []
        expect(braces.sort(), `${key} [${locale}] interpolation`).toEqual(understood.sort())
      }
    }
  })
})
