/**
 * Derives an OpenAPI paths object from Hono's own route table.
 *
 * The alternative is a hand-written literal, which is what auth-service has
 * and what CLAUDE.md criticises for not being derived from the code. At
 * ninety-odd routes that literal would drift within a sprint.
 *
 * What a route table knows is methods, paths and path parameters. It does not
 * know request bodies, response payloads or status codes, so none are emitted
 * here. An invented schema is worse than an absent one: absent, a reader goes
 * and reads the handler; invented, they trust it.
 */

export type RouteEntry = {
  readonly method: string
  readonly path: string
}

type DeriveOptions = {
  /** "GET /path" keys, Hono path form, to leave out of the document. */
  readonly exclude?: readonly string[]
  /**
   * Path prefix the session gate is mounted on. Routes outside it need no
   * session, so they must not be documented as needing one - the health
   * probes live at /health and are called cookie-less by Docker and K8s.
   * Omit to treat every route as gated.
   */
  readonly sessionPrefix?: string
  /** "GET /path" keys inside the gate that it lets through unauthenticated. */
  readonly anonymous?: readonly string[]
  /** "GET /path" keys where a session widens the response but is not required. */
  readonly optionalSession?: readonly string[]
  /** "GET /path" keys that also accept an X-Service-Auth secret. */
  readonly serviceAuth?: readonly string[]
}

type Operation = {
  tags: string[]
  parameters?: { name: string; in: 'path'; required: true; schema: { type: 'string' } }[]
  security: Record<string, string[]>[]
  responses: Record<string, unknown>
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'])

/**
 * Referenced, not inlined. Every operation carries the same two error
 * responses, and spelling them out is 186 identical copies in a document a
 * browser fetches on every docs load. The caller must define
 * components.responses.Error; index.ts does.
 */
const ERROR_RESPONSE = { $ref: '#/components/responses/Error' } as const

/** /projects/:id -> /projects/{id} */
export function toOpenApiPath(honoPath: string): string {
  return honoPath.replace(/:([^/]+)/g, '{$1}')
}

function pathParameters(openApiPath: string): NonNullable<Operation['parameters']> {
  return [...openApiPath.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path' as const,
    required: true as const,
    schema: { type: 'string' as const },
  }))
}

/** Groups the sidebar by resource: the segment after /api/v1, else the first. */
function tagFor(openApiPath: string): string {
  const segments = openApiPath.split('/').filter(Boolean)
  const isVersioned = segments[0] === 'api' && segments[1] === 'v1'
  return (isVersioned ? segments[2] : segments[0]) ?? 'root'
}

export function deriveOpenApiPaths(
  routes: readonly RouteEntry[],
  options: DeriveOptions = {},
): Record<string, Record<string, Operation>> {
  const exclude = new Set(options.exclude ?? [])
  const anonymous = new Set(options.anonymous ?? [])
  const optionalSession = new Set(options.optionalSession ?? [])
  const serviceAuth = new Set(options.serviceAuth ?? [])

  const paths: Record<string, Record<string, Operation>> = {}

  for (const route of routes) {
    // app.use() lands in this same table as method ALL. Seven of ours carry
    // concrete paths, so a trailing-'*' filter alone would document the strict
    // rate-limit tier as endpoints and emit 'all' as an HTTP operation.
    if (!HTTP_METHODS.has(route.method)) continue
    // A wildcard mount has no OpenAPI template. Nothing matches today; if one
    // appears, openapi-parity.test.ts fails rather than dropping it silently.
    if (route.path.includes('*')) continue
    if (exclude.has(`${route.method} ${route.path}`)) continue

    const openApiPath = toOpenApiPath(route.path)
    const parameters = pathParameters(openApiPath)
    const key = `${route.method} ${route.path}`

    const gated =
      options.sessionPrefix === undefined || route.path.startsWith(options.sessionPrefix)

    // An empty requirement object is OpenAPI for "this one may go unauthenticated".
    const security: Operation['security'] =
      !gated || anonymous.has(key)
        ? []
        : optionalSession.has(key)
          ? [{ sessionCookie: [] }, {}]
          : serviceAuth.has(key)
            ? [{ sessionCookie: [] }, { serviceAuth: [] }]
            : [{ sessionCookie: [] }]

    const operation: Operation = {
      tags: [tagFor(openApiPath)],
      ...(parameters.length > 0 ? { parameters } : {}),
      security,
      responses: { '4XX': ERROR_RESPONSE, '5XX': ERROR_RESPONSE },
    }

    paths[openApiPath] ??= {}
    // Same path, several methods: one path item, several operations.
    paths[openApiPath][route.method.toLowerCase()] = operation
  }

  return paths
}
