// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as resetRoute from './reset-password'

/**
 * Setting the new password from the mailed link.
 *
 * The token is the proof of identity here, which is why the form does not ask
 * for the current password. Requiring it would make recovery depend on the
 * thing the flow exists to replace.
 */

vi.setConfig({ testTimeout: 30_000 })

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const render = (search = '?token=tok-123') =>
  renderRoute(resetRoute, { path: '/reset-password', entry: `/reset-password${search}` })

describe('setting a new password', () => {
  it('never asks for the password that was forgotten', async () => {
    await render()

    expect(await screen.findByLabelText('New password')).toBeDefined()
    expect(screen.queryByLabelText(/current password/i)).toBeNull()
  })

  it('submits the new password with the token from the link', async () => {
    await render()

    await userEvent.type(await screen.findByLabelText('New password'), 'correct-horse')
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/auth/reset-password')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({ newPassword: 'correct-horse', token: 'tok-123' })
  })

  it('refuses two passwords that do not match, without calling the server', async () => {
    await render()

    await userEvent.type(await screen.findByLabelText('New password'), 'correct-horse')
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'battery-staple')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByText('Passwords do not match')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a password under the server minimum before sending it', async () => {
    await render()

    await userEvent.type(await screen.findByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByText('Password must be at least 8 characters')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /** A spent token is recoverable by asking again, not by retrying here. */
  it('sends a link with no token back to request another', async () => {
    await render('')

    expect(await screen.findByText('Incomplete link')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Send reset link' })).toBeDefined()
  })

  /**
   * Typed passwords are unreadable by default, which is right for a shared
   * screen and wrong when the two fields have to match. Both reveal together
   * or the check is still done blind.
   */
  it('reveals both fields together and says which state it is in', async () => {
    await render()

    const password = (await screen.findByLabelText('New password')) as HTMLInputElement
    const confirm = screen.getByLabelText('Repeat new password') as HTMLInputElement
    expect(password.type).toBe('password')

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))

    expect(password.type).toBe('text')
    expect(confirm.type).toBe('text')

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))

    expect(password.type).toBe('password')
    expect(confirm.type).toBe('password')
  })

  it('reports a token the server rejected', async () => {
    fetchMock.mockRejectedValue(new Error('invalid token'))
    await render()

    await userEvent.type(await screen.findByLabelText('New password'), 'correct-horse')
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(
      await screen.findByText('That link was already used or has expired. Request a new one.'),
    ).toBeDefined()
  })
})
