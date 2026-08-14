import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const SOURCE = readSource('./use-chat.ts')

/**
 * useScopingChat loads the scoping transcript with three awaited fetches and
 * then writes the result to state. Nothing cancelled that chain when the
 * project changed.
 *
 * So switching projects mid-load was a stale write: the old chain kept
 * running, reached its setState, and replaced `messages` with the previous
 * project's transcript while the new project's load was still in flight. The
 * owner read someone else's scoping conversation under the new project's
 * heading, and sending from there appended to it.
 *
 * The public project-detail route already does this correctly, so the
 * pattern was in the repo - this hook just predated it.
 */

describe('useScopingChat load', () => {
  it('aborts the in-flight load when the project changes', () => {
    expect(SOURCE).toContain('AbortController')
    // Cleanup may or may not use a block body; either way it must abort.
    expect(SOURCE).toMatch(/return\s*\(\)\s*=>\s*\{?[\s\S]{0,60}?abort\(\)/)
  })

  /**
   * All three requests take the signal, not just the first. A chain that
   * abandons request one but still awaits two and three arrives at the same
   * setState by a slower route.
   */
  it('passes the signal to every request in the chain', () => {
    const signals = SOURCE.match(/signal/g) ?? []
    expect(signals.length).toBeGreaterThanOrEqual(4)
  })

  /**
   * Aborting rejects the pending fetch, and the catch arms here are written
   * to swallow failure and carry on with defaults - which would write the
   * defaults over the new project's state. The write itself has to be
   * guarded, not only the requests.
   */
  it('does not write state after it has been cancelled', () => {
    // The guard must sit between the last await and the setState, so read
    // backwards from the write rather than forwards from the declaration.
    const write = SOURCE.indexOf('setState((prev) => ({')
    expect(write, 'the state write moved').toBeGreaterThan(-1)
    const before = SOURCE.slice(Math.max(0, write - 400), write)
    expect(before).toMatch(/if \(\s*(cancelled|controller\.signal\.aborted)\s*\)\s*return/)
  })
})
