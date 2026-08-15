// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as conversationRoute from './$conversationId'

/**
 * The thread an owner and a talent use to talk once a deal exists.
 *
 * Every message here is platform-mediated on purpose, and which side of the
 * thread a bubble lands on is decided by comparing the sender to the signed-in
 * user. Nothing had ever executed this file: it reported zero statements, so
 * it was outside the coverage denominator rather than counted as uncovered.
 */

vi.setConfig({ testTimeout: 30_000 })

/** jsdom has no scrollIntoView, and the thread pins itself to the bottom. */
Element.prototype.scrollIntoView = vi.fn()

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})
vi.mock('@/lib/centrifugo', () => ({
  connectCentrifugo: vi.fn(),
  disconnectCentrifugo: vi.fn(),
  subscribeTo: vi.fn(() => vi.fn()),
}))

const ME = { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' }

type ApiMessage = {
  id: string
  conversationId: string
  senderId: string | null
  senderType: 'user' | 'ai' | 'system'
  content: string
  metadata: null
  createdAt: string
}

function message(overrides: Partial<ApiMessage> & { id: string }): ApiMessage {
  return {
    conversationId: 'c-abcdef12',
    senderId: 'u2',
    senderType: 'user',
    content: 'Halo',
    metadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** The API answers newest-first; the page reverses it to read chronologically. */
function stubApi(newestFirst: ApiMessage[]) {
  apiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { success: true, data: message({ id: 'sent' }) }
    return {
      success: true,
      data: { items: newestFirst, total: newestFirst.length, page: 1, pageSize: 100 },
    }
  })
}

function render() {
  return renderRoute(conversationRoute, {
    path: '/messages/$conversationId',
    entry: '/messages/c-abcdef12',
    destinations: ['/messages'],
  })
}

/** Bubbles are laid out by justification, which is the only signal of side. */
function bubbleRow(text: string) {
  return screen.getByText(text).closest('div.flex.gap-2\\.5') as HTMLElement
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi([message({ id: 'm-1' })])
  useAuthStore.setState({ user: ME as never, isAuthenticated: true, isLoading: false })
})

describe('loading the thread', () => {
  it('shows a spinner rather than an empty thread', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByPlaceholderText('Type a message...')).toBeNull()
  })

  /** A failed fetch used to render as an empty conversation with no way back. */
  it('reports a failed load and offers a retry', async () => {
    apiFetch.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    await render()

    expect(await screen.findByText('Failed to load data')).toBeDefined()
    const retry = screen.getByRole('button', { name: 'Try Again' })

    apiFetch.mockReset()
    stubApi([message({ id: 'm-1', content: 'Sudah kembali' })])
    await user.click(retry)

    expect(await screen.findByText('Sudah kembali')).toBeDefined()
  })

  it('offers the way back to the message list', async () => {
    await render()

    expect(
      (await screen.findByRole('link', { name: 'Back to Messages' })).getAttribute('href'),
    ).toBe('/messages')
  })

  it('reads the thread oldest-first even though the API answers newest-first', async () => {
    stubApi([
      message({ id: 'm-2', content: 'Kedua', createdAt: '2026-03-01T05:00:00.000Z' }),
      message({ id: 'm-1', content: 'Pertama', createdAt: '2026-03-01T04:00:00.000Z' }),
    ])

    const { container } = await render()

    await screen.findByText('Pertama')
    const rendered = Array.from(container.querySelectorAll('div')).map((d) => d.textContent ?? '')
    const first = rendered.findIndex((text) => text.trim() === 'Pertama')
    const second = rendered.findIndex((text) => text.trim() === 'Kedua')
    expect(first).toBeLessThan(second)
  })
})

/**
 * Which side a message lands on comes from comparing its sender to the signed
 * in user. Getting it wrong attributes the other party's words to you.
 */
describe('telling your own messages from theirs', () => {
  it('puts your own message on the right and hides your name', async () => {
    stubApi([message({ id: 'm-1', senderId: 'u1', content: 'Pesan saya' })])

    await render()

    await screen.findByText('Pesan saya')
    expect(bubbleRow('Pesan saya').className).toContain('justify-end')
    expect(screen.queryByText('You')).toBeNull()
  })

  it('puts the other side on the left and names them', async () => {
    stubApi([message({ id: 'm-1', senderId: 'u2', content: 'Pesan mereka' })])

    await render()

    await screen.findByText('Pesan mereka')
    expect(bubbleRow('Pesan mereka').className).toContain('justify-start')
    expect(screen.getByText('Participant')).toBeDefined()
  })

  it('shows the assistant as a named participant, not as you', async () => {
    stubApi([message({ id: 'm-1', senderId: null, senderType: 'ai', content: 'Saya bantu' })])

    await render()

    await screen.findByText('Saya bantu')
    expect(screen.getByText('AI Assistant')).toBeDefined()
    expect(bubbleRow('Saya bantu').className).toContain('justify-start')
  })

  /** System notices belong to neither side, so they are centred and unnamed. */
  it('centres a system notice with no sender at all', async () => {
    stubApi([
      message({
        id: 'm-1',
        senderId: null,
        senderType: 'system',
        content: 'Proyek dimulai',
      }),
    ])

    const { container } = await render()

    await screen.findByText('Proyek dimulai')
    expect(container.querySelector('div.flex.justify-center')).not.toBeNull()
    expect(screen.queryByText('System')).toBeNull()
  })
})

describe('grouping the thread by day', () => {
  const DAY = 86_400_000

  it('separates today, yesterday and an older day', async () => {
    const now = Date.now()
    // Contents deliberately unlike the labels, which are what is asserted.
    stubApi([
      message({ id: 'm-3', content: 'Pesan C', createdAt: new Date(now).toISOString() }),
      message({ id: 'm-2', content: 'Pesan B', createdAt: new Date(now - DAY).toISOString() }),
      message({ id: 'm-1', content: 'Pesan A', createdAt: new Date(now - 40 * DAY).toISOString() }),
    ])

    await render()

    expect(await screen.findByText('Pesan A')).toBeDefined()
    // The labels are hardcoded Indonesian rather than routed through t().
    expect(screen.getByText('Hari ini')).toBeDefined()
    expect(screen.getByText('Kemarin')).toBeDefined()
    // The older one falls back to a formatted date, so it is neither label.
    expect(screen.getAllByText(/\d{4}/).length).toBeGreaterThan(0)
  })

  it('keeps two messages from the same day under one heading', async () => {
    const now = Date.now()
    stubApi([
      message({ id: 'm-2', content: 'Kedua', createdAt: new Date(now).toISOString() }),
      message({ id: 'm-1', content: 'Pertama', createdAt: new Date(now - 60_000).toISOString() }),
    ])

    await render()

    await screen.findByText('Pertama')
    expect(screen.getAllByText('Hari ini').length).toBe(1)
  })
})

describe('sending a message', () => {
  it('refuses to send an empty one', async () => {
    const user = userEvent.setup()
    await render()

    const send = await screen.findByRole('button', { name: 'Send' })
    expect(send.hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByPlaceholderText('Type a message...'), '   ')

    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
  })

  it('sends what was typed and clears the box', async () => {
    const user = userEvent.setup()
    await render()
    const box = await screen.findByPlaceholderText('Type a message...')

    await user.type(box, 'Kapan bisa mulai?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/chat/conversations/c-abcdef12/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Kapan bisa mulai?', senderType: 'user' }),
        }),
      ),
    )
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''))
  })

  it('trims the surrounding whitespace off what it sends', async () => {
    const user = userEvent.setup()
    await render()

    await user.type(await screen.findByPlaceholderText('Type a message...'), '  Halo  ')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/chat/conversations/c-abcdef12/messages',
        expect.objectContaining({
          body: JSON.stringify({ content: 'Halo', senderType: 'user' }),
        }),
      ),
    )
  })

  it('sends on Enter', async () => {
    const user = userEvent.setup()
    await render()

    await user.type(await screen.findByPlaceholderText('Type a message...'), 'Halo{Enter}')

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/chat/conversations/c-abcdef12/messages',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  /** Shift+Enter is how a multi-line message is written, not how it is sent. */
  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup()
    await render()
    const box = (await screen.findByPlaceholderText('Type a message...')) as HTMLTextAreaElement

    await user.type(box, 'Baris satu{Shift>}{Enter}{/Shift}Baris dua')

    expect(box.value).toBe('Baris satu\nBaris dua')
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('the conversation header', () => {
  it('names the thread from its id and states the participant count', async () => {
    await render()

    expect(await screen.findByRole('heading', { name: 'Conversation c-abcdef' })).toBeDefined()
    // participantCount is hardcoded to 2 regardless of who is actually in it.
    expect(screen.getByText('2 participants')).toBeDefined()
  })

  it('shows the initial taken from the conversation id', async () => {
    const { container } = await render()

    await screen.findByRole('heading', { name: 'Conversation c-abcdef' })
    expect(within(container).getByText('C')).toBeDefined()
  })
})
