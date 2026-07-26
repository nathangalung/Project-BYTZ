import { describe, expect, it } from 'vitest'

/**
 * `useToastStore()` with no selector subscribes the component to the whole
 * store. addToast appends to an array and so mints a new state object, and
 * the toast auto-dismisses five seconds later with a second write - so every
 * toast re-rendered each subscribing component twice.
 *
 * On these routes that is expensive: several are eight or nine hundred lines
 * with no component boundary between the store hook at the top and the JSX
 * at the bottom, so approving one milestone re-rendered the whole page and
 * then did it again on dismissal.
 *
 * Selecting the action alone subscribes to a stable function reference, and
 * the component stops re-rendering when the toast list changes at all.
 */

const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * The container renders the toasts, so it has to subscribe to them. It is the
 * one place where re-rendering on every change is the entire point.
 */
const RENDERS_THE_TOASTS = 'components/layout/toast-container.tsx'

describe('toast store subscriptions', () => {
  const offenders = Object.entries(SOURCES)
    .filter(([file]) => !file.includes('.test.'))
    .filter(([file]) => !file.endsWith(RENDERS_THE_TOASTS))
    .filter(([, body]) => body.includes('useToastStore()'))
    .map(([file]) => file.replace('../', ''))

  it('select the action rather than the whole store', () => {
    expect(offenders, `these re-render on every toast: ${offenders.join(', ')}`).toEqual([])
  })
})
