# Architecture

A TypeScript client for the Instagram mobile private API. The design is plain layered,
with ports and adapters applied only at the three seams that are volatile or need to be
mocked in tests.

## Layers

```
core/transport   HTTP port + adapters (node https default, fetch, fake, retry), device state, headers
core/signing     signing port + adapter, isolated, pinned by golden vectors
core/crypto      password encryption, USDID identity, attestation (CAA login)
core/bloks       Bloks payload builders and response parsers (CAA login)
core/session     session/state port + adapters (memory, file)
core/http        orchestrates transport + signing + session: lossless JSON, typed error mapping
core/media       dependency-free JPEG/MP4 metadata parsers (upload)
core/pagination  the Page<T> contract and the paginate() iterator
schemas          hand-written zod schemas for API responses (User, Media, Thread, ...)
endpoints/*      hand-written feature modules (auth, user, friendship, feed, media, direct, upload)
client           public, ergonomic facade (IgFlare), retry-wrapped by default
types / errors   shared models and typed errors
generated        the endpoint registry (name -> method + path) from `npm run gen`; never edited
```

Retry/backoff on transient failures lives in a `RetryTransport` decorator over the
transport port, not in `core/http`. An endpoint's method and path come from the
generated registry; everything else about the endpoint is hand-written.

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

## Response and error contract

Every endpoint follows one shape, so a caller learns it once:

- **Success returns the model, not an envelope.** An endpoint returns the parsed,
  typed domain model directly (`User`, `Media`, …). There is no `{ ok, data }`
  wrapper; absence of a thrown error is success.
- **Failure throws a typed error.** Everything that can go wrong surfaces as an
  `IgError` subclass — the `IgApiError` taxonomy (`BadPasswordError`,
  `ChallengeRequiredError`, `RateLimitError`, …) for API failures, mapped in one
  place (`core/http/response.ts`, reused by the CAA flow). Endpoints never return
  an error value.
- **Responses are validated at the boundary with zod, leniently.** A schema types
  and validates only the fields the SDK exposes; everything else passes through
  (`z.looseObject` / `.loose()`), and the API's own fields are `optional`/`nullable` so a
  benign upstream change does not break callers. The types tell the truth about
  nullability rather than overpromising.
- **A response that fails its schema is a typed error too** (carrying the raw body),
  never a leaked zod exception.

Schemas are hand-written and co-located until enough endpoints justify generating
them from the manifest (see `DEFERRED.md`).

## Finding things

Before adding a file, check this document and grep the tree for an existing home. The
layer map above is the index of where each kind of thing lives.
