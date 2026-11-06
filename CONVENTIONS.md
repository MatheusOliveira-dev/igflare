# Conventions

Most conventions are enforced by tooling, not by this document. A convention that a tool
can check lives in that tool's config; this file holds only what tools cannot check.

## Enforced by tooling

- Formatting: Prettier (`.prettierrc.json`). Indentation and style are not a matter of taste.
- Lint: ESLint with typescript-eslint strict + stylistic, import boundaries, sonarjs.
- Naming: camelCase for values, PascalCase for types, CONSTANT_CASE for true constants,
  kebab-case filenames, named exports only.
- Commits: Conventional Commits (`commitlint`).
- Boundaries: `dependency-cruiser` (see `ARCHITECTURE.md`).

## Not checkable by tools

- Errors are typed: throw an `IgError` subclass, never a raw string or a plain `Error`.
- Every endpoint and function ships with a test. Unit tests follow arrange-act-assert, one
  behavior per test. Signing and response parsing also get property tests and golden
  vectors against recorded fixtures.
- Prefer small, pure functions at the seams so they can be tested without the network.

## Running checks

`npm run ci` runs the full gate locally. Individual gates: `typecheck`, `lint`,
`format:check`, `test`, `coverage`, `dup`, `deadcode`, `deps`, `gen:check`, `api`.
