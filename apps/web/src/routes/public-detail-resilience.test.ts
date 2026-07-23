import { describe, expect, it } from 'vitest'
import source from './_public/project-detail.$projectId.tsx?raw'

/**
 * The public project detail page loaded project and work packages in one
 * Promise.all where both had to resolve. Work packages are owner-gated, so an
 * anonymous visitor got 401, the whole load rejected, and the page fell to the
 * error state without ever rendering the project. Work packages now load on
 * their own and tolerate failure.
 */
describe('public project detail survives an owner-gated work-packages failure', () => {
  it('does not throw the work-packages response into the shared catch', () => {
    expect(source).not.toContain('work packages fetch')
  })

  it('defaults work packages to null on failure', () => {
    expect(source).toContain('.catch(() => null)')
  })
})
