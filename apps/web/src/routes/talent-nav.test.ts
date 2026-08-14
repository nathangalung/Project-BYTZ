import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const projectDetailSource = readSource('./_authenticated/projects/$projectId/index.tsx')
const talentHomeSource = readSource('./_authenticated/talent/index.tsx')

/**
 * The talent view was a navigational dead end. Active-project cards on the home
 * were plain divs, so a talent could not open their own project to submit work,
 * and the project-detail back link pointed at /projects, an owner-only route
 * that bounces a talent to the dashboard.
 */
describe('talent can navigate their own work', () => {
  it('links each active-project card to the project detail', () => {
    expect(talentHomeSource).toContain('to="/projects/$projectId"')
  })

  it('sends the talent back to their own home, not the owner project list', () => {
    expect(projectDetailSource).toContain("role === 'talent' ? '/talent' : '/projects'")
  })
})
