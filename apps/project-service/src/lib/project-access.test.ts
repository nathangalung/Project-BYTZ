import { beforeEach, describe, expect, it, vi } from 'vitest'

// Queued result sets, consumed in query order:
//   1. projects           -> [{ ownerId }]
//   2. talentProfiles     -> [{ id }]
//   3. projectAssignments -> [{ id }]
let queue: Array<Array<Record<string, unknown>>> = []

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => queue.shift() ?? [],
        }),
      }),
    }),
  }),
}))

const { assertProjectAccess } = await import('./project-access')

beforeEach(() => {
  queue = []
})

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'NO_THROW'
  } catch (e) {
    return (e as { code?: string }).code ?? 'UNKNOWN'
  }
}

describe('assertProjectAccess', () => {
  it('allows the project owner', async () => {
    queue = [[{ ownerId: 'user-1' }]]
    await expect(assertProjectAccess('proj-1', 'user-1')).resolves.toBeUndefined()
  })

  it('allows a talent assigned to the project', async () => {
    queue = [[{ ownerId: 'someone-else' }], [{ id: 'talent-profile-1' }], [{ id: 'assignment-1' }]]
    await expect(assertProjectAccess('proj-1', 'user-2')).resolves.toBeUndefined()
  })

  // The regression this guards: session middleware proves you are signed in,
  // not that this project is yours. Without the check any authenticated user
  // could read another project's time logs by id.
  it('refuses a signed-in user who is neither owner nor talent', async () => {
    queue = [[{ ownerId: 'someone-else' }], []]
    expect(await codeOf(assertProjectAccess('proj-1', 'stranger'))).toBe('AUTH_FORBIDDEN')
  })

  it('refuses a talent who is not assigned to this project', async () => {
    queue = [[{ ownerId: 'someone-else' }], [{ id: 'talent-profile-9' }], []]
    expect(await codeOf(assertProjectAccess('proj-1', 'other-talent'))).toBe('AUTH_FORBIDDEN')
  })

  it('reports a missing project as NOT_FOUND', async () => {
    queue = [[]]
    expect(await codeOf(assertProjectAccess('nope', 'user-1'))).toBe('NOT_FOUND')
  })

  it('does not query further once ownership matches', async () => {
    queue = [[{ ownerId: 'user-1' }], [{ id: 'should-not-be-read' }]]
    await assertProjectAccess('proj-1', 'user-1')
    // The talent lookup must not have consumed its result set.
    expect(queue).toHaveLength(1)
  })
})
