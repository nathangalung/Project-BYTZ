import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The contrast of text tokens, measured rather than asserted by eye.
 *
 * A browser pass found green text at 2.14:1 and coral at 2.53:1 on the light
 * surfaces this app actually paints, against the 4.5:1 the accessibility
 * section asks for. Nothing could catch that: a component test renders a class
 * name, not a colour, so the only thing that fails when someone lightens a
 * value back is a check that does the arithmetic.
 */

const AA_TEXT = 4.5

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')
const styles = read('./styles.css')
const tokens = read('../../../packages/ui-kit/src/tokens.css')

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function block(source: string, opener: string): string {
  const start = source.indexOf(opener)
  if (start === -1) throw new Error(`missing block: ${opener}`)
  const end = source.indexOf('\n}', start)
  return source.slice(start, end)
}

function tokensIn(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, name, hex] of source.matchAll(/--(color-[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)) {
    found.set(name, hex)
  }
  return found
}

const lightTokens = new Map([
  ...tokensIn(block(tokens, '@theme {')),
  ...tokensIn(block(styles, '@theme {')),
])
const darkTokens = new Map([...lightTokens, ...tokensIn(block(styles, '.dark {'))])

const SURFACE_KEYS = [
  'color-surface',
  'color-surface-dim',
  'color-surface-container',
  'color-surface-low',
  'color-surface-high',
  'color-surface-bright',
]

function surfaces(source: Map<string, string>): [string, string][] {
  return SURFACE_KEYS.map((key) => {
    const hex = source.get(key)
    if (!hex) throw new Error(`missing surface token: ${key}`)
    return [key, hex]
  })
}

function textRules(prefix: string): [string, string][] {
  const pattern = new RegExp(
    `${prefix}\\s+\\.(text-[a-z0-9-]+)\\s*\\{\\s*color:\\s*(#[0-9a-f]{6})`,
    'g',
  )
  return [...styles.matchAll(pattern)].map(([, klass, hex]) => [klass, hex])
}

const lightRules = textRules('html:not\\(\\.dark\\)')
const darkRules = textRules('html\\.dark')

describe('status text overrides', () => {
  it('covers every status colour the app renders as text', () => {
    expect(lightRules.map(([klass]) => klass).sort()).toEqual([
      'text-accent-coral-500',
      'text-accent-coral-600',
      'text-error-500',
      'text-error-600',
      'text-success-500',
      'text-success-600',
      'text-warning-600',
    ])
  })

  it.each(lightRules)('%s clears AA on every light surface', (_klass, hex) => {
    for (const [key, surface] of surfaces(lightTokens)) {
      expect(contrast(hex, surface), `${hex} on ${key}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it.each(darkRules)('%s clears AA on every dark surface', (_klass, hex) => {
    for (const [key, surface] of surfaces(darkTokens)) {
      expect(contrast(hex, surface), `${hex} on ${key}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })
})

describe('body and secondary text tokens', () => {
  const bodyKeys = ['color-on-surface', 'color-on-surface-muted', 'color-on-surface-subtle']

  it.each(bodyKeys)('%s clears AA on every light surface', (key) => {
    const hex = lightTokens.get(key)
    expect(hex, key).toBeDefined()
    for (const [surfaceKey, surface] of surfaces(lightTokens)) {
      expect(contrast(hex as string, surface), `${key} on ${surfaceKey}`).toBeGreaterThanOrEqual(
        AA_TEXT,
      )
    }
  })

  it.each(bodyKeys)('%s clears AA on every dark surface', (key) => {
    const hex = darkTokens.get(key)
    expect(hex, key).toBeDefined()
    for (const [surfaceKey, surface] of surfaces(darkTokens)) {
      expect(contrast(hex as string, surface), `${key} on ${surfaceKey}`).toBeGreaterThanOrEqual(
        AA_TEXT,
      )
    }
  })
})

describe('text that sits on the brand fill, not on a surface', () => {
  // The authenticated sidebar paints bg-primary-800 in both themes, so its
  // wordmark reads against that fill. The light-surface coral above measured
  // 2.79:1 there, which is how this token came to exist.
  const FILL = 'color-primary-800'

  it.each([
    ['color-on-brand-coral', 3],
    ['color-white', 4.5],
  ])('%s clears its threshold on the sidebar fill', (key, threshold) => {
    const fill = lightTokens.get(FILL)
    const hex = key === 'color-white' ? '#ffffff' : lightTokens.get(key)
    expect(hex, key).toBeDefined()
    expect(fill, FILL).toBeDefined()
    expect(contrast(hex as string, fill as string)).toBeGreaterThanOrEqual(threshold)
  })

  it('keeps the fill the same in both themes', () => {
    expect(darkTokens.get(FILL)).toBe(lightTokens.get(FILL))
  })
})

describe('the rating star, which is a graphic and not text', () => {
  // WCAG 1.4.11 asks 3:1 for a graphical object needed to understand content,
  // against every colour adjacent to it. For a star that means the surfaces
  // behind it AND the fill it is drawn on top of.
  const NON_TEXT = 3
  const fills = ['color-accent-cream-500', 'color-accent-cream-600']

  it('clears 3:1 on every light surface', () => {
    const hex = lightTokens.get('color-star-outline')
    expect(hex, 'color-star-outline').toBeDefined()
    for (const [surfaceKey, surface] of surfaces(lightTokens)) {
      expect(
        contrast(hex as string, surface),
        `star outline on ${surfaceKey}`,
      ).toBeGreaterThanOrEqual(NON_TEXT)
    }
  })

  it.each(fills)('clears 3:1 against the %s it is drawn on', (fillKey) => {
    const hex = lightTokens.get('color-star-outline')
    const fill = lightTokens.get(fillKey)
    expect(fill, fillKey).toBeDefined()
    expect(contrast(hex as string, fill as string)).toBeGreaterThanOrEqual(NON_TEXT)
  })

  it('clears 3:1 on every dark surface, where cream needs no help', () => {
    const hex = darkTokens.get('color-star-outline')
    expect(hex, 'color-star-outline').toBeDefined()
    for (const [surfaceKey, surface] of surfaces(darkTokens)) {
      expect(
        contrast(hex as string, surface),
        `star outline on ${surfaceKey}`,
      ).toBeGreaterThanOrEqual(NON_TEXT)
    }
  })

  // The token exists because the fill cannot carry this itself. If someone
  // makes them equal again the star goes back to being a flat cream shape on
  // a cream-ish surface, which is the bug.
  it('is not simply the cream it outlines', () => {
    expect(lightTokens.get('color-star-outline')).not.toBe(
      lightTokens.get('color-accent-cream-600'),
    )
  })
})

describe('the palette entries these overrides exist to work around', () => {
  // Left alone on purpose: the same tokens feed bg-success-600 and friends,
  // which carry white text. Lightening or darkening them there is a regression.
  it.each([
    ['color-success-600', '#7fa84e'],
    ['color-error-600', '#d47367'],
    ['color-accent-coral-600', '#d47367'],
  ])('%s is still the brand fill value', (key, hex) => {
    expect(lightTokens.get(key)).toBe(hex)
  })
})
