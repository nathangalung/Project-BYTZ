/**
 * apps/project-service/.dependency-cruiser.cjs
 * Run: depcruise --config .dependency-cruiser.cjs --ts-config tsconfig.json src
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Two modules in a cycle are one module wearing two names: neither can be tested, ' +
        'changed or tree-shaken independently.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'repository-is-a-leaf',
      severity: 'error',
      comment:
        'Repositories are the bottom layer. Reaching back up to routes, middleware or services ' +
        'inverts the dependency and makes the repository untestable without an HTTP stack.',
      from: { path: '^src/repositories/' },
      to: { path: '^src/(routes|middleware|services)/' },
    },
    {
      name: 'service-no-routes',
      severity: 'error',
      comment:
        'A service importing a route module inverts Route -> Service. Move the shared factory ' +
        'into services/ and let the route import it.',
      from: { path: '^src/services/' },
      to: { path: '^src/routes/' },
    },
    {
      name: 'service-no-http-framework',
      severity: 'error',
      comment:
        'Business logic must not know about HTTP. Take plain arguments, return plain values; ' +
        'let the route translate to and from Hono.',
      from: { path: '^src/services/' },
      to: { path: '^hono($|/)' },
    },
    {
      name: 'route-no-direct-db',
      severity: 'error',
      comment:
        'Route handlers go through src/repositories rather than query Drizzle directly. ' +
        'The seventeen files listed below already do, and are named rather than waved ' +
        'through by a blanket warning: a named exception is a debt item somebody can ' +
        'burn down, a warning is a shrug that never fails a build. Removing a name from ' +
        'this list is how the debt gets paid. Adding one needs a reason in the PR. ' +
        'health.ts is permanent - its SELECT 1 readiness probe owns no domain data.',
      from: {
        path: '^src/routes/',
        pathNot:
          '^src/routes/(health|activities|applications|chat|contracts|disputes|invoices|' +
          'matching|milestones|projects|realtime|reviews|talent-placement|talent-profiles|' +
          'talents|time-logs|upload|work-packages)\\.ts$',
      },
      // Matched on the module string, not dependencyTypes: bun workspace packages
      // resolve as "unknown" to dependency-cruiser, so an ['npm'] filter never fires.
      to: { path: '^@kerjacus/db$' },
    },
    {
      name: 'lib-is-infrastructure',
      severity: 'error',
      comment:
        'lib/ is the shared kernel (env, http clients, resilience, templates). Every layer ' +
        'imports it, so it must import none of them or everything becomes cyclic.',
      from: { path: '^src/lib/' },
      to: { path: '^src/(routes|services|repositories|middleware)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(test|spec)\\.ts$|^src/(tests|features)/' },
    // Type-only imports are erased at build time. False keeps these rules on real
    // runtime coupling. Flip to true to also surface compile-time-only cycles
    // (currently: middleware/session.ts <-> middleware/session-cache.ts).
    tsPreCompilationDeps: false,
  },
}
