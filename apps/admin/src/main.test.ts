// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The entry point, which nothing else imports.
 *
 * It is four statements, and one of them is the guard that turns a missing
 * mount node into a named error instead of `createRoot(null)` failing somewhere
 * inside React. A deploy that ships an index.html without `<div id="root">`
 * is exactly when a reader needs the message to say so.
 *
 * react-dom is mocked because the assertion is what main.tsx hands it, not
 * what React does next, and a real mount would pull the whole route tree.
 */

/*
 * Importing main.tsx pulls the router and its whole route tree through vite's
 * transform, and that cost lands inside the test rather than at import time.
 * Under the default five seconds this file passes when admin runs alone and
 * times out when web's suite is running beside it - which is exactly how CI
 * runs both workspaces. Matched to the 30s every route test here already uses.
 */
vi.setConfig({ testTimeout: 30_000 })

const createRoot = vi.hoisted(() => vi.fn())
vi.mock('react-dom/client', () => ({ createRoot }))

beforeEach(() => {
  vi.resetModules()
  createRoot.mockReset()
  createRoot.mockReturnValue({ render: vi.fn(), unmount: vi.fn() })
  document.body.replaceChildren()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('the admin entry point', () => {
  it('mounts the router into the root element', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    await import('./main')

    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(createRoot.mock.calls[0][0]).toBe(root)
    const { render } = createRoot.mock.results[0].value as { render: ReturnType<typeof vi.fn> }
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('names the missing mount node rather than failing inside React', async () => {
    await expect(import('./main')).rejects.toThrow('Root element not found')

    expect(createRoot).not.toHaveBeenCalled()
  })
})
