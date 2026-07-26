import { describe, expect, it } from 'vitest'

/**
 * The intake wizard was one 1635-line module holding nine components, their
 * shared types, their constants and their validation.
 *
 * The components were already separate functions - they had nowhere to live.
 * That is what made everything else on this route expensive: with no module
 * boundary there is nothing to stop a re-render, and no way to read or change
 * one step without loading the entire intake flow.
 */

const MODULES = import.meta.glob('./*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const ROUTE = import.meta.glob('../../../routes/_authenticated/projects/new.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const route = Object.values(ROUTE)[0] ?? ''

describe('the wizard modules', () => {
  it('has one file per component', () => {
    const names = Object.keys(MODULES)
      .map((f) => f.replace('./', '').replace(/\.tsx?$/, ''))
      .filter((n) => !n.includes('.test'))
    expect(names.sort()).toEqual([
      'path-a-form',
      'path-b-form',
      'path-chooser',
      'shared',
      'step-basic-info',
      'step-budget-timeline',
      'step-indicator',
      'step-preferences',
      'step-review',
    ])
  })

  /**
   * A module nobody can read at a sitting is the thing being fixed, so the
   * ceiling is asserted rather than left to drift back.
   */
  it('keeps every module readable at a sitting', () => {
    for (const [file, body] of Object.entries(MODULES)) {
      if (file.includes('.test')) continue
      const lines = body.split('\n').length
      expect(lines, `${file} is ${lines} lines`).toBeLessThan(320)
    }
  })
})

describe('the route module', () => {
  it('is orchestration, not the wizard', () => {
    expect(route.split('\n').length).toBeLessThan(450)
  })

  /**
   * The types and constants live in shared. Redeclaring them here is how the
   * two copies of the BRD normaliser drifted, and the same trap applies.
   */
  it('does not redeclare what shared owns', () => {
    for (const declaration of [
      'type FormData = {',
      'type BriefFormData = {',
      'const STEPS =',
      'const CATEGORIES =',
      'function parseBudget',
    ]) {
      expect(route, `route redeclares ${declaration}`).not.toContain(declaration)
    }
  })

  // Its test imports the payload builder from the route, so the name stays.
  it('still exposes the payload builder', () => {
    expect(route).toContain('buildCreateProjectPayload')
  })
})
