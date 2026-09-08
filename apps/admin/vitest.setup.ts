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
  const { cleanup, configure } = await import('@testing-library/react')
  afterEach(cleanup)

  /**
   * How long findBy waits, which is not the same clock as testTimeout.
   *
   * Testing Library's default is one second and it is independent of vitest's
   * timeout, so raising testTimeout does nothing for it. CI runs ten
   * workspaces at once and a query that resolves in well under a second on a
   * quiet machine can miss that window under load: a docs-only commit failed
   * on a tab still reading its loading value at 1217ms. The assertion was
   * right and the wait was too short, which is the worst kind of red because
   * it points at code that is fine.
   */
  configure({ asyncUtilTimeout: 5_000 })
}
