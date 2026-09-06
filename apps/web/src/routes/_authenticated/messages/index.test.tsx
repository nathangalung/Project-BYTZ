// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
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
