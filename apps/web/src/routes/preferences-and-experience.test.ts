import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const browse = readSource('./_authenticated/browse.tsx')
const matching = readSource('./_authenticated/projects/$projectId/matching.tsx')
const register = readSource('./_authenticated/talent/register.tsx')
const browseProjects = readSource('./_public/browse-projects.tsx')
const publicDetail = readSource('./_public/project-detail.$projectId.tsx')

/**
 * preferences stores requiredSkills (camelCase), but four pages read the
 * snake_case required_skills, so skills never reached matching and never
 * rendered on browse or detail. And the experience select values (0-1, 1-3, ...)
 * were stripped of non-digits, turning "1-3" into 13 years.
 */
describe('preferences read the key that is actually stored', () => {
  it.each([
    ['authenticated browse', browse],
    ['public browse', browseProjects],
    ['public detail', publicDetail],
  ])('%s reads preferences.requiredSkills', (_name, source) => {
    expect(source).toContain('?.requiredSkills')
    expect(source).not.toContain('?.required_skills')
  })

  // Matching stopped reading preferences: each position carries its own
  // requiredSkills from the work package, which is the real skill target.
  it('matching renders per-position requiredSkills', () => {
    expect(matching).toContain('requiredSkills')
    expect(matching).not.toContain('?.required_skills')
  })
})

describe('experience bucket maps to a real number', () => {
  it('does not strip non-digits off the bucket', () => {
    expect(register).not.toContain('replace(/\\D/g')
  })

  it('maps each bucket explicitly', () => {
    expect(register).toContain('EXPERIENCE_YEARS')
  })
})
