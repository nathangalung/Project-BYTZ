import { beforeEach, describe, expect, it } from 'vitest'
import { useToastStore } from './toast'

/**
 * The id was `Date.now().toString()`. Two toasts raised inside the same
 * millisecond - a mutation that reports both a success and a follow-up, say -
 * shared one id. React saw duplicate keys, and `removeToast` filters by id, so
 * dismissing either one removed both.
 */

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

describe('toast ids', () => {
  it('are distinct for toasts raised in the same tick', () => {
    const { addToast } = useToastStore.getState()
    addToast('success', 'first')
    addToast('info', 'second')

    const ids = useToastStore.getState().toasts.map((toast) => toast.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('dismisses only the toast that was dismissed', () => {
    const { addToast } = useToastStore.getState()
    addToast('success', 'first')
    addToast('info', 'second')

    const [first] = useToastStore.getState().toasts
    useToastStore.getState().removeToast(first.id)

    const remaining = useToastStore.getState().toasts
    expect(remaining).toHaveLength(1)
    expect(remaining[0].message).toBe('second')
  })
})
