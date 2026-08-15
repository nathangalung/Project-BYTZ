import { describe, expect, it } from 'vitest'
import { deriveOpenApiPaths, type RouteEntry, toOpenApiPath } from './openapi'

/**
 * openapi-parity.test.ts checks the served document against the live route
 * table, and deliberately re-derives its expectation rather than calling this
 * helper. That leaves the helper's own edges untested: what it does when the
 * caller passes no options at all, and what it does with paths that have no
 * resource segment to name a tag after.
 *
 * Those are the halves that only run when index.ts changes how it calls this,
 * which is exactly when nobody is looking at openapi.ts.
 */

const route = (method: string, path: string): RouteEntry => ({ method, path })

describe('toOpenApiPath', () => {
  it('rewrites every parameter, not just the first', () => {
    expect(toOpenApiPath('/projects/:id/milestones/:milestoneId')).toBe(
      '/projects/{id}/milestones/{milestoneId}',
    )
  })
})

describe('deriveOpenApiPaths without options', () => {
  /**
   * index.ts passes all four sets today. Called bare - which the signature's
   * `options: DeriveOptions = {}` default explicitly permits - every lookup
   * has to fall back to an empty set rather than throwing on undefined.
   */
  it('treats every filter as empty rather than failing', () => {
    const paths = deriveOpenApiPaths([route('GET', '/api/v1/projects')])

    expect(paths).toEqual({
      '/api/v1/projects': {
        get: {
          tags: ['projects'],
          security: [{ sessionCookie: [] }],
          responses: {
            '4XX': { $ref: '#/components/responses/Error' },
            '5XX': { $ref: '#/components/responses/Error' },
          },
        },
      },
    })
  })

  it('gates every route when no sessionPrefix narrows the mount', () => {
    const paths = deriveOpenApiPaths([route('GET', '/health')])

    expect(paths['/health']?.get?.security).toEqual([{ sessionCookie: [] }])
  })
})

describe('deriveOpenApiPaths tagging', () => {
  it('falls back to root when a versioned path has no resource segment', () => {
    const paths = deriveOpenApiPaths([route('GET', '/api/v1')])

    expect(paths['/api/v1']?.get?.tags).toEqual(['root'])
  })

  it('falls back to root for the bare mount path', () => {
    const paths = deriveOpenApiPaths([route('GET', '/')])

    expect(paths['/']?.get?.tags).toEqual(['root'])
  })

  it('tags an unversioned path by its first segment', () => {
    const paths = deriveOpenApiPaths([route('GET', '/health/ready')])

    expect(paths['/health/ready']?.get?.tags).toEqual(['health'])
  })
})

describe('deriveOpenApiPaths filtering', () => {
  /**
   * The comment on the filter says nothing matches today and that a wildcard
   * appearing later must fail parity rather than vanish. Nothing proved the
   * filter itself works, so a mount added tomorrow would have been dropped
   * silently by a branch that had never executed.
   */
  it('drops a wildcard mount, which has no OpenAPI template', () => {
    const paths = deriveOpenApiPaths([
      route('GET', '/api/v1/projects/*'),
      route('GET', '/api/v1/projects'),
    ])

    expect(Object.keys(paths)).toEqual(['/api/v1/projects'])
  })

  it('drops non-HTTP methods that app.use() leaves in the table', () => {
    const paths = deriveOpenApiPaths([route('ALL', '/api/v1/projects')])

    expect(paths).toEqual({})
  })
})
