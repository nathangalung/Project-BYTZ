import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The PRD tells us which work package blocks which, and the schema has a table
 * with a cycle guard and a unique index waiting for it, but the generate route
 * only ever created the packages. Every project's dependency graph was empty,
 * so nothing downstream could order the work or find a critical path.
 */
const projects = readFileSync(path.join(__dirname, 'projects.ts'), 'utf8')
const matching = readFileSync(path.join(__dirname, 'matching.ts'), 'utf8')

describe('the PRD route', () => {
  it('persists the graph the PRD describes', () => {
    expect(projects).toContain('planDependencies(prdContent, allWps)')
    expect(projects).toMatch(/wpService\.addDependency\(\s*edge\.workPackageId/)
  })

  it('parses the PRD once and reuses it for both plans', () => {
    expect(projects).toContain('const prdContent = normalizePrdContent(prdData)')
    expect(projects).toContain('planWorkPackages(prdContent, clampedTeamSize, project.title)')
  })

  it('only runs where a real edge can exist', () => {
    expect(projects).toContain('if (allWps.length > 1) {')
  })

  it('skips an edge already stored rather than the whole pass', () => {
    // A PRD written before this must still backfill on regenerate.
    expect(projects).toMatch(/existing\.has\(`\$\{edge\.workPackageId\}/)
    expect(projects).toContain('await wpService.getDependencies(projectId)')
  })

  it('contains a rejected edge so the rest of the graph survives', () => {
    expect(projects).toContain("console.error('work package dependency skipped', depErr)")
  })
})

describe('the positions endpoint', () => {
  it('sends each open position the work it waits on', () => {
    expect(matching).toContain('dependsOn: prerequisites.get(w.id) ?? []')
    expect(matching).toContain('groupPrerequisiteTitles(edges,')
  })

  it('reads titles from every package, not just the open ones', () => {
    // A prerequisite is usually already staffed.
    expect(matching).toMatch(/from\(workPackages\)\s*\.where\(eq\(workPackages\.projectId/)
    expect(matching).toMatch(/inArray\(\s*workPackageDependencies\.workPackageId/)
  })

  it('skips both queries when no position is open', () => {
    expect(matching).toContain('if (open.length === 0) return new Map()')
  })
})
