/** Enforces the layered + ports-and-adapters boundaries. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Circular dependencies make modules impossible to reason about in isolation.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'endpoints-only-via-ports',
      comment:
        'Endpoints depend on core ports (interfaces), never on concrete adapters. Tests may use fakes.',
      severity: 'error',
      from: { path: '^src/endpoints', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/core/[^/]+/adapters/' },
    },
    {
      name: 'core-must-not-import-client',
      comment: 'Dependencies point inward: core and endpoints never reach up into the facade.',
      severity: 'error',
      from: { path: '^src/(core|endpoints)' },
      to: { path: '^src/client' },
    },
    {
      name: 'client-is-private',
      comment: 'Only the package entry and the facade itself may import the facade.',
      severity: 'error',
      from: { pathNot: '^src/(client|index\\.ts)' },
      to: { path: '^src/client/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require'],
    },
  },
};
