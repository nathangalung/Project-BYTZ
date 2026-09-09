// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as messagesRoute from './index'

/**
 * The conversation list. Its whole job is naming threads so a person can tell
 * them apart, and it was failing at exactly that: the API sent no project
 * title, so the list built a label from the project id. Every seeded project
 * shares an id prefix, so every row read "Project 00000000".
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const ME = { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' }

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    projectId: '00000000-0000-7000-8000-000000000001',
    type: 'owner_talent',
    createdAt: new Date().toISOString(),
    ...over,
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({ user: ME as never, isAuthenticated: true, isLoading: false })
})

describe('conversation list naming', () => {
  it('labels a thread with its project title', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [conversation({ projectTitle: 'Mobile App Booking Lapangan Futsal' })],
    })

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText('Mobile App Booking Lapangan Futsal')).toBeTruthy())
  })

  /** Two threads on different projects must not read identically. */
  it('keeps two threads distinguishable', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [
        conversation({ id: 'c1', projectTitle: 'Booking Futsal' }),
        conversation({
          id: 'c2',
          projectId: '00000000-0000-7000-8000-000000000002',
          projectTitle: 'Kasir UMKM',
        }),
      ],
    })

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText('Booking Futsal')).toBeTruthy())
    expect(screen.getByText('Kasir UMKM')).toBeTruthy()
  })

  /** A thread can outlive its project row, and still needs a label. */
  it('falls back to the project id when the title is gone', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [conversation({ projectTitle: null })] })

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText(/Project 00000000/)).toBeTruthy())
  })
})

describe('the four states', () => {
  it('shows a spinner while the list is in flight', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await renderRoute(messagesRoute)

    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('says the request failed and offers a retry', async () => {
    apiFetch.mockRejectedValue(new Error('down'))

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeTruthy())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(1))
  })

  it('says there are no threads rather than drawing an empty list', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [] })

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText('No messages yet')).toBeTruthy())
    expect(screen.getByText('Your conversations will appear here')).toBeTruthy()
  })
})

describe('narrowing the list', () => {
  function twoKinds() {
    apiFetch.mockResolvedValue({
      success: true,
      data: [
        conversation({ id: 'c1', projectTitle: 'Booking Futsal' }),
        conversation({ id: 'c2', type: 'admin_mediation', projectTitle: 'Sengketa Kasir' }),
      ],
    })
  }

  it('keeps both kinds under the All tab', async () => {
    twoKinds()

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText('Booking Futsal')).toBeTruthy())
    expect(screen.getByText('Sengketa Kasir')).toBeTruthy()
  })

  /** admin_mediation is the dispute thread, and it belongs under Support. */
  it('files a mediation thread under Support and a deal thread under Projects', async () => {
    twoKinds()
    const user = userEvent.setup()

    await renderRoute(messagesRoute)
    await waitFor(() => expect(screen.getByText('Booking Futsal')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /Support/ }))
    expect(screen.getByText('Sengketa Kasir')).toBeTruthy()
    expect(screen.queryByText('Booking Futsal')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Projects/ }))
    expect(screen.getByText('Booking Futsal')).toBeTruthy()
    expect(screen.queryByText('Sengketa Kasir')).toBeNull()
  })

  it('matches the search whatever the case', async () => {
    twoKinds()
    const user = userEvent.setup()

    await renderRoute(messagesRoute)
    await waitFor(() => expect(screen.getByText('Booking Futsal')).toBeTruthy())

    await user.type(screen.getByPlaceholderText('Search conversations...'), 'FUTSAL')

    expect(screen.getByText('Booking Futsal')).toBeTruthy()
    expect(screen.queryByText('Sengketa Kasir')).toBeNull()
  })

  it('says nothing matched instead of leaving the list blank', async () => {
    twoKinds()
    const user = userEvent.setup()

    await renderRoute(messagesRoute)
    await waitFor(() => expect(screen.getByText('Booking Futsal')).toBeTruthy())

    await user.type(screen.getByPlaceholderText('Search conversations...'), 'tidak ada')

    expect(screen.getByText('No messages yet')).toBeTruthy()
  })
})

describe('the row itself', () => {
  it('links to the thread and counts its participants', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [conversation({ projectTitle: 'Booking Futsal' })],
    })

    await renderRoute(messagesRoute, { destinations: ['/messages/$conversationId'] })

    const row = await screen.findByRole('link', { name: /Booking Futsal/ })
    expect(row.getAttribute('href')).toBe('/messages/c1')
    expect(screen.getByText('2 participants')).toBeTruthy()
  })

  /** Fill and text ship as a pair, so a row cannot land on an unreadable one. */
  it('cycles the avatar colours and takes the initial from the label', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: Array.from({ length: 6 }, (_, i) =>
        conversation({ id: `c${i}`, projectTitle: `Proyek ${i}` }),
      ),
    })

    const { container } = await renderRoute(messagesRoute)
    await waitFor(() => expect(screen.getByText('Proyek 0')).toBeTruthy())

    const avatars = Array.from(container.querySelectorAll('.h-11.w-11'))
    expect(avatars.map((n) => n.textContent)).toEqual(['P', 'P', 'P', 'P', 'P', 'P'])
    expect(avatars[0].className).toBe(avatars[5].className)
    expect(avatars[0].className).not.toBe(avatars[1].className)
  })

  /** An unparseable timestamp must not take the whole list down with it. */
  it('drops an unreadable timestamp instead of throwing', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [conversation({ projectTitle: 'Booking Futsal', createdAt: 'not a date' })],
    })

    await renderRoute(messagesRoute)

    await waitFor(() => expect(screen.getByText('Booking Futsal')).toBeTruthy())
  })
})
