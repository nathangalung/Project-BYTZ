// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The entry module, which runs its work at import rather than exporting it.
 *
 * Only two things here are decisions rather than wiring: it mounts into the
 * element index.html actually ships, and it refuses to start when that element
 * is missing instead of rendering into nothing. The second is the one worth a
 * test - a silent no-op start is a blank page with a clean console, which is
 * the most expensive kind of failure to diagnose.
 *
 * Importing this pulls routeTree.gen and with it every route module, so the
 * timeout is generous and react-dom is mocked to stop the app actually
 * mounting. Nothing is asserted about the router itself; authenticated-shell
 * and the per-route suites own that.
 */

vi.setConfig({ testTimeout: 60_000 })

const { render, createRoot } = vi.hoisted(() => {
  const render = vi.fn()
  return {
    render,
    createRoot: vi.fn((_container: Element | DocumentFragment) => ({
      render,
      unmount: vi.fn(),
    })),
  }
})

vi.mock('react-dom/client', () => ({ createRoot, default: { createRoot } }))

beforeEach(() => {
  createRoot.mockClear()
  render.mockClear()
  vi.resetModules()
})

describe('starting the app', () => {
  it('mounts into the root element index.html ships', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = document.getElementById('root')

    await import('./main')

    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(createRoot.mock.calls[0][0]).toBe(root)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('refuses to start when the root element is missing', async () => {
    document.body.innerHTML = '<div id="not-root"></div>'

    await expect(import('./main')).rejects.toThrow('Root element not found')
  })

  it('mounts nothing at all when the root element is missing', async () => {
    document.body.innerHTML = ''

    await expect(import('./main')).rejects.toThrow()

    expect(createRoot).not.toHaveBeenCalled()
  })
})
