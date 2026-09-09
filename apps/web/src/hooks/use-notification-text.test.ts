import { renderHook } from '@testing-library/react'
import i18n from 'i18next'
import { describe, expect, it } from 'vitest'
import { useNotificationText } from './use-notification-text'
import '@/lib/i18n'

// @vitest-environment jsdom

function render() {
  return renderHook(() => useNotificationText()).result.current
}

describe('useNotificationText', () => {
  it('renders a catalog key in the active language', async () => {
    await i18n.changeLanguage('id')
    const got = render()({
      title: 'Milestone approved',
      message: 'stale English',
      templateKey: 'notification.milestone_approved',
      templateParams: { amount: 7_150_000 },
    })
    expect(got.title).toBe('Milestone disetujui')
    expect(got.message).toContain('Rp 7.150.000')
  })

  it('follows a language switch rather than the stored wording', async () => {
    await i18n.changeLanguage('en')
    const got = render()({
      title: 'anything',
      message: 'anything',
      templateKey: 'notification.milestone_approved',
      templateParams: { amount: 5_000_000 },
    })
    expect(got.title).toBe('Milestone approved')
    expect(got.message).toContain('Rp 5.000.000')
    await i18n.changeLanguage('id')
  })

  // Rows written before the catalog existed carry no key, and the wording they
  // already hold is the correct answer for them.
  it('falls back to the stored wording when there is no key', () => {
    const got = render()({
      title: 'Stored title',
      message: 'Stored message',
      templateKey: null,
      templateParams: null,
    })
    expect(got).toEqual({ title: 'Stored title', message: 'Stored message' })
  })

  // An unknown key means this reader is older than the notification. Printing
  // the key at the reader would be worse than printing what the row holds.
  it('falls back when the key is not in the catalog', () => {
    const got = render()({
      title: 'Stored title',
      message: 'Stored message',
      templateKey: 'notification.from_a_newer_deploy',
      templateParams: null,
    })
    expect(got).toEqual({ title: 'Stored title', message: 'Stored message' })
  })

  // Params go through i18next's `replace`. Spread into the options object, a
  // param named `count` would stop being a value and start steering the lookup
  // into plural resolution.
  it('interpolates a param named count without pluralising', () => {
    const got = render()({
      title: 'x',
      message: 'y',
      templateKey: 'notification.milestone_due_soon',
      templateParams: { days: 7, count: 99 },
    })
    expect(got.message).toContain('7')
    expect(got.message).not.toContain('99')
  })

  it('leaves a missing param visible rather than blanking it', () => {
    const got = render()({
      title: 'x',
      message: 'y',
      templateKey: 'notification.milestone_due_soon',
      templateParams: {},
    })
    expect(got.message).toContain('{{days}}')
  })
})
