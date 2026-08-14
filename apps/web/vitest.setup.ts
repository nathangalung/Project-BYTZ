import { afterEach } from 'vitest'

/**
 * Unmount what a test rendered, so the next one queries a clean document.
 *
 * Testing Library only auto-cleans when vitest runs with `globals: true`, and
 * this workspace does not. Without it every render stacks up in the same body
 * and getByText fails with "found multiple elements" on the second case in a
 * file, which reads as a broken component rather than a missing hook.
 *
 * Guarded on the environment because this file loads for the whole workspace
 * and most tests here are plain logic running in node, where importing the
 * DOM cleanup would throw before any test body runs.
 */
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}

/**
 * jsdom does not implement matchMedia, and the theme store reads
 * prefers-color-scheme at module load, so importing any route that reaches it
 * throws before a test body runs. Code splitting used to hide this by keeping
 * route modules out of the test build entirely.
 *
 * Reports "no preference" rather than dark, so a component branching on the
 * media query takes its default path unless a test says otherwise.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
