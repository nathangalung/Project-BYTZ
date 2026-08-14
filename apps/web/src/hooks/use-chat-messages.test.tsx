// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, withQueryClient } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useChatMessages, useConversations } from './use-chat-messages'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, apiFetch }
})

const unsubscribe = vi.hoisted(() => vi.fn())
const subscribeTo = vi.hoisted(() => vi.fn())
vi.mock('../lib/centrifugo', () => ({ subscribeTo }))

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  subscribeTo.mockReturnValue(unsubscribe)
  client = createTestQueryClient()
  useAuthStore.setState({
    user: { id: 'me', email: 'me@kerjacus.id', name: 'Me', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

function renderWith<T>(hook: () => T) {
  return renderHook(hook, { wrapper: withQueryClient(client) })
}

function page(items: unknown[]) {
  return { success: true, data: { items, total: items.length, page: 1, pageSize: 100 } }
}

describe('useConversations', () => {
  it('waits for a signed-in user before asking', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })

    renderWith(() => useConversations())

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('returns the threads the user takes part in', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [{ id: 'c1', type: 'owner_talent' }] })

    const { result } = renderWith(() => useConversations())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })

  it('degrades to an empty thread list rather than undefined', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(() => useConversations())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  /** Two accounts on one browser must not share a cached thread list. */
  it('keys the cache by user so a re-login refetches', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [] })
    const first = renderWith(() => useConversations())
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))

    useAuthStore.setState({
      user: { id: 'other', email: 'o@k.id', name: 'O', role: 'talent', locale: 'id' },
      isAuthenticated: true,
      isLoading: false,
    })
    const second = renderWith(() => useConversations())
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))

    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

/**
 * The API pages messages newest-first because that is the cheap index order,
 * but a transcript reads oldest-first. Getting this wrong renders the whole
 * conversation backwards.
 */
describe('useChatMessages ordering and naming', () => {
  it('reverses the newest-first page into reading order', async () => {
    apiFetch.mockResolvedValue(
      page([
        { id: 'm2', senderId: 'me', senderType: 'user', content: 'second', createdAt: '2' },
        { id: 'm1', senderId: 'me', senderType: 'user', content: 'first', createdAt: '1' },
      ]),
    )

    const { result } = renderWith(() => useChatMessages('c1'))

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages.map((m) => m.content)).toEqual(['first', 'second'])
  })

  it.each([
    ['me', 'user', 'You'],
    ['someone-else', 'user', 'Participant'],
    [null, 'ai', 'AI Assistant'],
    [null, 'system', 'System'],
  ])('labels sender %s of type %s as %s', async (senderId, senderType, expected) => {
    apiFetch.mockResolvedValue(
      page([{ id: 'm1', senderId, senderType, content: 'x', createdAt: '1' }]),
    )

    const { result } = renderWith(() => useChatMessages('c1'))

    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].senderName).toBe(expected)
  })

  it('renders an empty transcript rather than crashing on a missing items array', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(() => useChatMessages('c1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.messages).toEqual([])
  })

  it('reports a failed load so the panel can show an error state', async () => {
    apiFetch.mockRejectedValue(new Error('down'))

    const { result } = renderWith(() => useChatMessages('c1'))

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('does not fetch without a conversation id', () => {
    renderWith(() => useChatMessages(''))

    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('useChatMessages realtime', () => {
  it('subscribes to the conversation channel', () => {
    apiFetch.mockResolvedValue(page([]))

    renderWith(() => useChatMessages('c1'))

    expect(subscribeTo).toHaveBeenCalledWith('chat:c1', expect.any(Function))
  })

  it('does not subscribe without a conversation id', () => {
    renderWith(() => useChatMessages(''))

    expect(subscribeTo).not.toHaveBeenCalled()
  })

  it('a pushed message refreshes that conversation only', () => {
    apiFetch.mockResolvedValue(page([]))
    renderWith(() => useChatMessages('c1'))
    const spy = vi.spyOn(client, 'invalidateQueries')

    const onMessage = subscribeTo.mock.calls[0][1] as (data: unknown) => void
    onMessage({ id: 'm9' })

    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-messages', 'c1'] })
  })

  it('unsubscribes when the panel closes', () => {
    apiFetch.mockResolvedValue(page([]))
    const { unmount } = renderWith(() => useChatMessages('c1'))

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('sending a message', () => {
  it('posts the trimmed content and refreshes the transcript', async () => {
    apiFetch.mockResolvedValue(page([]))
    const { result } = renderWith(() => useChatMessages('c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const spy = vi.spyOn(client, 'invalidateQueries')

    await result.current.sendMessage('  hello  ')

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/chat/conversations/c1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: 'hello', senderType: 'user' }),
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-messages', 'c1'] })
  })

  /** An accidental Enter on an empty box must not post a blank message. */
  it('refuses to send whitespace', async () => {
    apiFetch.mockResolvedValue(page([]))
    const { result } = renderWith(() => useChatMessages('c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    apiFetch.mockClear()

    await result.current.sendMessage('   ')

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('propagates a rejected send to the caller', async () => {
    apiFetch.mockResolvedValueOnce(page([]))
    const { result } = renderWith(() => useChatMessages('c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    apiFetch.mockRejectedValue(new Error('rejected'))

    await expect(result.current.sendMessage('hi')).rejects.toThrow('rejected')
  })
})
