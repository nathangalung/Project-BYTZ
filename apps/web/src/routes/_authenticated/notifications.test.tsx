// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { renderRoute } from '@/lib/testing/harness'
import * as notificationsRoute from './notifications'

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const NOTIFICATION = {
  id: 'n-1',
  type: 'milestone_update',
  title: 'Milestone dikirim',
  message: 'Backend API menunggu review',
  link: '/projects/p-1/milestones',
  isRead: false,
  createdAt: '2026-09-01T00:00:00.000Z',
}

function stub(items: unknown[]) {
  apiFetch.mockImplementation(async () => ({ success: true, data: { items, total: items.length } }))
}

function render() {
  return renderRoute(notificationsRoute, {
    path: '/notifications',
    destinations: ['/projects/$projectId/milestones'],
  })
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('the notification list', () => {
  it('shows each notification with its message', async () => {
    stub([NOTIFICATION])

    await render()

    expect(await screen.findByText('Backend API menunggu review')).toBeDefined()
  })

  it('says the inbox is empty when it genuinely is', async () => {
    stub([])

    await render()

    expect(await screen.findByText('No Notifications Yet')).toBeDefined()
  })
})

/**
 * `data?.items ?? []` swallowed the failure, so a request that never answered
 * rendered "no notifications" - the same words as a quiet inbox, on a page
 * whose entire purpose is telling the owner something happened.
 *
 * The failures that reach this branch are the ones `isIgnorableError` keeps
 * out of the error boundary on purpose, because the list polls every two
 * minutes and a boundary is the wrong answer to one dropped poll. Offline is
 * one of them, which is exactly when an owner opens this page and reads the
 * empty state as "nothing happened".
 */
describe('when the notifications cannot be loaded', () => {
  beforeEach(() => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
  })

  it('says the request failed instead of claiming the inbox is empty', async () => {
    await render()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load your notifications')
    expect(screen.queryByText('No Notifications Yet')).toBeNull()
  })

  it('offers a retry that asks again', async () => {
    await render()

    const alert = await screen.findByRole('alert')
    const before = apiFetch.mock.calls.length
    within(alert).getByRole('button').click()

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(before))
  })
})

/** A 404 is swallowed by the same rule, and must not read as an empty inbox. */
it('says so when the endpoint answers 404 rather than showing an empty inbox', async () => {
  apiFetch.mockRejectedValue(new ApiError('gone', 404, 'NOT_FOUND'))

  await render()

  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load your notifications',
  )
})
