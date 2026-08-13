/**
 * apps/web/.dependency-cruiser.cjs
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
      name: 'lib-and-stores-are-leaves',
      severity: 'error',
      comment:
        'lib/ and stores/ are the bottom of the frontend. Importing a component or a route ' +
        'from them creates a cycle and drags the router into every bundle that wants a helper.',
      from: { path: '^src/(lib|stores)/' },
      to: { path: '^src/(components|routes)/' },
    },
    {
      name: 'components-no-routes',
      severity: 'error',
      comment:
        'Components must stay route-agnostic and reusable. Pass data in as props rather than ' +
        'importing a route module.',
      from: { path: '^src/components/' },
      to: { path: '^src/routes/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // routeTree.gen.ts is generated and imports every route by design.
    // Test files use Vite `?raw` to read route source as text - not a runtime edge.
    exclude: { path: '\\.(test|spec)\\.(ts|tsx)$|\\.gen\\.tsx?$|\\?raw$' },
    tsPreCompilationDeps: false,
  },
}
