# Architecture

A TypeScript client for the Instagram mobile private API. The design is plain layered,
with ports and adapters applied only at the three seams that are volatile or need to be
mocked in tests.

## Layers

```
core/transport   HTTP port + adapter (undici/fetch), device state, header injection
core/signing     signing port + adapter, isolated, pinned by golden vectors
core/session     session/state port + adapters (memory, file)
core/http        orchestrates transport + signing + session: retries, error mapping
schemas          zod schemas for API responses, generated from the manifest
endpoints/*      feature modules (auth, user, feed, media, direct), generated from the manifest
client           public, ergonomic facade
types / errors   shared models and typed errors
generated        output of `npm run gen`; never edited by hand
```

Folders appear as the code that fills them lands, not before — no empty scaffolding.

## Dependency rule

Enforced by `dependency-cruiser` (`.dependency-cruiser.cjs`), not by convention:

- `endpoints` depend on core **ports** (interfaces), never on concrete adapters.
- `client` depends on `endpoints`; nothing depends on `client` except the package entry.
- Adapters are leaves.
- No cycles.

## Single source of truth

`manifest/endpoints.json` describes the endpoints. `npm run gen` turns it into
`src/generated/`. The manifest is validated before generation, and CI checks that the
committed generated code matches the manifest. Change endpoints in the manifest, never in
the generated files.

## Finding things

Before adding a file, check this document and grep the tree for an existing home. The
layer map above is the index of where each kind of thing lives.
