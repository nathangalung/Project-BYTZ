// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as rootRoute from './__root'

/**
 * The outermost route: query provider, toast host, suspense boundary and the
 * session hydration every other page depends on.
 *
 * Nothing mounted it. The hydration effect is the load-bearing part - every
 * authenticated route reads the store this fills - and its abort on unmount is
 * what stops a resolved request from writing a stale user back after the app
 * has navigated away.
 *
 * `<Outlet />` renders nothing here because the harness registers routes as
 * siblings, so the assertions are about the shell itself.
 */

vi.setConfig({ testTimeout: 30_000 })

const render = () => renderRoute(rootRoute, { path: '/' })

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ hydrate: vi.fn(async () => {}) })
})

describe('session hydration', () => {
  it('asks the store to hydrate as soon as the app mounts', async () => {
    await render()

    const hydrate = useAuthStore.getState().hydrate as ReturnType<typeof vi.fn>
    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it('hands hydration a signal and aborts it when the app unmounts', async () => {
    const { unmount } = await render()

    const hydrate = useAuthStore.getState().hydrate as ReturnType<typeof vi.fn>
    const signal = hydrate.mock.calls[0][0] as AbortSignal
    expect(signal.aborted).toBe(false)

    unmount()

    expect(signal.aborted).toBe(true)
  })
})

describe('the shell it renders', () => {
  it('paints the app surface for the page to sit on', async () => {
    const { container } = await render()

    expect(container.querySelector('.min-h-screen.bg-surface')).not.toBeNull()
  })

  it('hosts no toast while the store is empty', async () => {
    await render()

    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull()
  })

  it('shows a toast the moment something pushes one', async () => {
    await render()

    useToastStore.getState().addToast('success', 'Perubahan tersimpan')

    expect(await screen.findByText('Perubahan tersimpan')).toBeDefined()
  })

  it('dismisses a toast from its own control', async () => {
    const user = userEvent.setup()
    await render()
    useToastStore.getState().addToast('error', 'Gagal menyimpan')
    await screen.findByText('Gagal menyimpan')

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    await waitFor(() => expect(screen.queryByText('Gagal menyimpan')).toBeNull())
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('stacks more than one toast at a time', async () => {
    await render()

    useToastStore.getState().addToast('info', 'Pertama')
    useToastStore.getState().addToast('warning', 'Kedua')

    expect(await screen.findByText('Pertama')).toBeDefined()
    expect(screen.getByText('Kedua')).toBeDefined()
  })
})
