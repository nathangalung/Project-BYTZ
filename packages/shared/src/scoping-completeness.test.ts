import { describe, expect, it } from 'vitest'
import {
  COMPLETENESS_KEYS,
  COMPLETENESS_KEYWORDS,
  DESCRIPTION_MIN_CHARS,
  REQUIREMENTS_MIN_CHARS,
} from './scoping-completeness'

describe('completeness keys', () => {
  it('carries the eleven checks the score is an average of', () => {
    expect(COMPLETENESS_KEYS).toHaveLength(11)
  })

  it('leads with description, which both scorers special-case', () => {
    expect(COMPLETENESS_KEYS[0]).toBe('description')
  })

  it('names each check once, since the score divides by the count', () => {
    expect(new Set(COMPLETENESS_KEYS).size).toBe(COMPLETENESS_KEYS.length)
  })
})

describe('the keyword table', () => {
  const keyed = COMPLETENESS_KEYS.filter((key) => key !== 'description')

  it('answers every key but description, which is measured by length', () => {
    expect(Object.keys(COMPLETENESS_KEYWORDS).sort()).toEqual([...keyed].sort())
  })

  it.each(keyed)('gives %s words to match on', (key) => {
    expect(COMPLETENESS_KEYWORDS[key].length).toBeGreaterThan(0)
  })

  // The scorers lower-case the transcript before testing membership, so a
  // capitalised entry here can never match anything. That is the dead-branch
  // shape this table exists to prevent, not a style rule.
  it.each(keyed)('keeps %s lowercase, or it never matches', (key) => {
    const cased = COMPLETENESS_KEYWORDS[key].filter((w) => w !== w.toLowerCase())
    expect(cased).toEqual([])
  })

  it.each(keyed)('does not repeat a word inside %s', (key) => {
    const words = COMPLETENESS_KEYWORDS[key]
    expect(new Set(words).size).toBe(words.length)
  })

  it.each(keyed)('holds no blank or padded entry in %s', (key) => {
    const bad = COMPLETENESS_KEYWORDS[key].filter((w) => w.trim() !== w || w === '')
    expect(bad).toEqual([])
  })
})

describe('length floors', () => {
  it('asks more of the whole conversation than of the description alone', () => {
    expect(REQUIREMENTS_MIN_CHARS).toBeGreaterThan(DESCRIPTION_MIN_CHARS)
  })

  it('keeps both floors positive, or the check passes on empty text', () => {
    expect(DESCRIPTION_MIN_CHARS).toBeGreaterThan(0)
    expect(REQUIREMENTS_MIN_CHARS).toBeGreaterThan(0)
  })
})
