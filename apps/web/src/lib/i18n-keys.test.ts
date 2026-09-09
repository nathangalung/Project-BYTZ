import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every literal t() key has to resolve in the namespace its file asked for.
 *
 * i18next answers a missing key with the key itself, so a wrong namespace
 * renders "doc_status_review" on the page and nothing fails. Coverage does not
 * see it either: v8 counts the t() call as executed and never looks at what
 * came back. Three surfaces shipped that way - the PRD status badge, three
 * headings in the PRD body, and the Gantt loading line - and each was found by
 * eye rather than by a test.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = join(SRC, 'locales')
const LANGUAGES = ['id', 'en'] as const

// i18next appends these to the base key.
const PLURAL_SUFFIXES = ['', '_zero', '_one', '_two', '_few', '_many', '_other']

const NAMESPACE_DECL = /useTranslation\(\s*'([a-z]+)'/g
const T_CALL = /\bt\(\s*'([a-zA-Z0-9_.]+)'\s*(?:\)|,\s*(?:\{([^}]*)\}|'[^']*'))/g
const NS_OPTION = /\bns:\s*'([a-z]+)'/

type Catalog = Record<string, Record<string, unknown>>

function loadCatalog(language: string): Catalog {
  const dir = join(LOCALES, language)
  const catalog: Catalog = {}
  for (const file of readdirSync(dir)) {
    catalog[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  }
  return catalog
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'locales' && entry.name !== 'testing') found.push(...sourceFiles(path))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue
    if (entry.name === 'routeTree.gen.ts') continue
    found.push(path)
  }
  return found
}

/** Reads a dotted key out of one namespace. */
function has(catalog: Catalog, namespace: string, key: string): boolean {
  const table = catalog[namespace]
  if (!table) return false
  return PLURAL_SUFFIXES.some((suffix) => {
    let node: unknown = table
    for (const part of `${key}${suffix}`.split('.')) {
      if (typeof node !== 'object' || node === null) return false
      node = (node as Record<string, unknown>)[part]
    }
    return node !== undefined
  })
}

type Usage = { file: string; line: number; namespace: string; key: string }

function usages(): Usage[] {
  const collected: Usage[] = []
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    const declared = [...new Set([...text.matchAll(NAMESPACE_DECL)].map((m) => m[1]))]
    // A file that binds two different namespaces cannot be read by position.
    if (declared.length !== 1) continue
    for (const call of text.matchAll(T_CALL)) {
      // A positional default hides the miss on screen and still leaves the
      // other language without the string, so it is not an excuse either.
      const options = call[2] ?? ''
      collected.push({
        file: relative(SRC, file),
        line: text.slice(0, call.index).split('\n').length,
        namespace: NS_OPTION.exec(options)?.[1] ?? declared[0],
        key: call[1],
      })
    }
  }
  return collected
}

describe('translation keys', () => {
  const found = usages()

  it('reads enough call sites to be worth trusting', () => {
    expect(found.length).toBeGreaterThan(500)
  })

  for (const language of LANGUAGES) {
    it(`resolve in ${language}`, () => {
      const catalog = loadCatalog(language)
      const missing = found
        .filter((u) => !has(catalog, u.namespace, u.key))
        .map((u) => `${u.file}:${u.line} ${u.namespace}:${u.key}`)
      expect(missing).toEqual([])
    })
  }
})
