import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every list route bounds its own pagination, and they did not agree.
 *
 * pageSize was capped at 100 in the schemas that had one, page was capped
 * nowhere, and offset is the product of the two, so `?page=100000000` made
 * Postgres walk that many index entries to return an empty array. Three routes
 * skipped Zod altogether and read the query string through a bare Number(),
 * which puts an attacker-chosen LIMIT into the SQL and turns `?page=abc` into
 * OFFSET NaN. One of those three, GET /projects/public, needs no session.
 *
 * Six copies of the same two lines is why they drifted, so the fix is that
 * pagination bounds have exactly one definition. This test fails on the seventh
 * copy rather than waiting for it to be found the way these were.
 */

const ROUTES_DIR = __dirname

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [full]
  })
}

const FILES = routeFiles(ROUTES_DIR).map((file) => ({
  name: path.relative(ROUTES_DIR, file),
  source: readFileSync(file, 'utf8'),
}))

describe('pagination bounds', () => {
  it('finds route files to check', () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  /**
   * A bare Number() cannot reject. It yields NaN for a word, a negative for a
   * minus sign, and whatever integer was asked for otherwise, and every one of
   * those reaches the query builder.
   */
  it('never reads a pagination parameter through a bare Number()', () => {
    for (const { name, source } of FILES) {
      for (const param of ['page', 'pageSize', 'limit', 'offset']) {
        expect(source, `${name} parses ${param} without validating it`).not.toMatch(
          new RegExp(`Number\\(\\s*c\\.req\\.query\\(['"\`]${param}['"\`]`),
        )
      }
    }
  })

  /**
   * Redeclaring the field is how the cap went missing on four of these. The
   * shared schema is the only place the bounds are written.
   */
  it('declares no local page field outside the shared schema', () => {
    for (const { name, source } of FILES) {
      expect(source, `${name} declares its own page bound`).not.toMatch(
        /page:\s*z\.coerce\.number\(\)/,
      )
    }
  })

  it('derives every pagination schema from the shared one', () => {
    for (const { name, source } of FILES) {
      if (!/\bpageSize\b/.test(source)) continue
      expect(source, `${name} paginates without deriving from paginationSchema`).toMatch(
        /paginationSchema/,
      )
    }
  })
})
