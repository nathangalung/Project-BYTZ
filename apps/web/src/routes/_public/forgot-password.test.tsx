// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import * as forgotRoute from './forgot-password'

/**
 * The recovery path that did not exist.
 *
 * auth-service wired sendResetPassword and the rate limiter already named
 * /forget-password, but apps/web had no route and login had no link, so the
 * only way to change a password was the settings form, which demands the
 * current one. Someone who had forgotten it had nowhere to go.
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

const render = () => renderRoute(forgotRoute, { path: '/forgot-password' })

describe('requesting a reset link', () => {
  it('asks for the email alone, never the current password', async () => {
    await render()

    expect(await screen.findByLabelText('Email')).toBeDefined()
    expect(screen.queryByLabelText(/current password/i)).toBeNull()
  })

  it('sends the address and where the mailed link should land', async () => {
    await render()

    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/auth/forget-password')
    const body = JSON.parse(String(init?.body))
    expect(body.email).toBe('owner@example.test')
    expect(String(body.redirectTo)).toContain('/reset-password')
  })

  /**
   * The same answer either way. A form that says "no such account" is an
   * account-existence oracle, which is why no large provider distinguishes.
   */
  it('confirms identically when the address is unknown', async () => {
    fetchMock.mockRejectedValue(new Error('not found'))
    await render()

    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@example.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Check your email')).toBeDefined()
  })
})
