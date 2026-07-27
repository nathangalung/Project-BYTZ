import { describe, expect, it } from 'vitest'
import SOURCE from './_authenticated/messages/$conversationId.tsx?raw'

/**
 * A conversation renders up to a hundred bubbles. Each one used to call
 * `useAuthStore()` with no selector to read a single user id, so every bubble
 * subscribed to the whole auth store, and each one constructed its own
 * Intl.DateTimeFormat - the expensive half of formatting a timestamp.
 *
 * Typing in the composer re-rendered the route on every keystroke, and with
 * the message list rebuilt inline there was nothing memo could hold onto.
 */

describe('conversation render cost', () => {
  it('reads the user id once, in the parent, with a selector', () => {
    expect(SOURCE).not.toContain('useAuthStore()')
    expect(SOURCE).toContain('useAuthStore((s) => s.user?.id)')
  })

  it('memoises the bubble so keystrokes do not re-render the list', () => {
    expect(SOURCE).toContain('const MessageBubble = memo(')
    // memo is worthless if the message objects are rebuilt every render.
    expect(SOURCE).toContain('const messages: ChatMessage[] = useMemo(')
    expect(SOURCE).toContain('useMemo(() => groupMessagesByDate(messages), [messages])')
  })

  it('builds its date formatters once at module scope', () => {
    expect(SOURCE).toContain('const TIME_FORMAT = new Intl.DateTimeFormat')
    expect(SOURCE).toContain('const LONG_DATE_FORMAT = new Intl.DateTimeFormat')
    // Exactly the two module-level ones: none left inside a render path.
    expect(SOURCE.match(/new Intl\.DateTimeFormat/g)).toHaveLength(2)
  })

  /**
   * A failed fetch resolved to an empty message list, which rendered exactly
   * like a brand new conversation - no error, no retry, nothing to click.
   */
  it('renders a retry instead of an empty conversation when the fetch fails', () => {
    expect(SOURCE).toContain('isError')
    expect(SOURCE).toContain('refetch')
    expect(SOURCE).toContain("tc('error_loading')")
    expect(SOURCE).toContain("tc('retry')")
  })
})
